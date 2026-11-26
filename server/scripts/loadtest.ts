// Load test: N клієнтів (ws) в одній кімнаті літають і стріляють.
// Для кожного N - новий сервер, 5 с прогрів, 20 с замір (крок, ELU, RSS, байти/с).
//
// npm run loadtest --workspace=server            (N = 8, 32, 64, 128, 192, 256)
// npm run loadtest --workspace=server -- 8 16    (свої N)
// LOAD_LABEL=after - у який файл docs/load/<label>.json записати результат
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { encodeInput } from 'shared/codec/binary.ts';
import { asSeq } from 'shared/types.ts';

const PORT = 3400;
const WARMUP_S = 5;
const MEASURE_S = 20;
const counts = process.argv.slice(2).map(Number).filter((n) => n > 0);
const LIST = counts.length > 0 ? counts : [8, 32, 64, 128, 192, 256];
const serverDir = path.resolve(import.meta.dirname, '..');

interface TickSummary {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}
interface StatsResponse {
  elu: number;
  rssMb: number;
  heapMb: number;
  matches: Array<{ entities: number; tickMs: TickSummary | null; overruns: number }>;
  clients: Array<{ bytesOut: number; bytesIn: number }>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function startServer(): Promise<ChildProcess> {
  // той самий node і ті самі прапорці (--import tsx), з якими запущено цей скрипт
  const child = spawn(process.execPath, [...process.execArgv, 'src/index.ts'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', MAX_PLAYERS: '1024', MAX_CONN_PER_IP: '10000', LOG_DIR: './logs/loadtest' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    child.stdout?.on('data', (d: Buffer) => {
      if (d.toString().includes('слухаю')) resolve(child);
    });
    child.on('exit', (code) => reject(new Error(`сервер завершився з кодом ${code}`)));
  });
}

async function getStats(reset = false): Promise<StatsResponse> {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/stats${reset ? '?reset=1' : ''}`);
  return (await res.json()) as StatsResponse;
}

// клієнт: join, потім 30 input/с за своїм сценарієм (різні гравці - різні траєкторії)
function startClient(i: number): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  let seq = 0;
  let timer: NodeJS.Timeout | undefined;
  ws.on('open', () => {
    ws.send(JSON.stringify({ v: 0, type: 'join', room: 'belt', name: `load-${i}` }));
    timer = setInterval(() => {
      seq++;
      const phase = (seq + i * 17) % 120;
      ws.send(
        encodeInput({
          seq: asSeq(seq),
          turn: phase < 30 ? 1 : phase < 50 ? -1 : 0,
          thrust: phase % 4 !== 0,
          fire: (seq + i) % 3 === 0,
          missile: (seq + i) % 90 === 0,
          flip: false,
        }),
      );
    }, 1000 / 30);
  });
  ws.on('message', () => {}); // знімки просто приймаємо (байти рахує сервер)
  ws.on('close', () => clearInterval(timer));
  ws.on('error', () => clearInterval(timer));
  return ws;
}

interface Row {
  n: number;
  entities: number;
  tickP50: number;
  tickP95: number;
  tickP99: number;
  tickMax: number;
  overruns: number;
  elu: number;
  rssMb: number;
  outMBs: number;
}

const rows: Row[] = [];
for (const n of LIST) {
  const server = await startServer();
  const clients: WebSocket[] = [];
  for (let i = 0; i < n; i++) {
    clients.push(startClient(i));
    await sleep(5); // не всі одночасно
  }
  await sleep(WARMUP_S * 1000);
  await getStats(true);
  await sleep(MEASURE_S * 1000);
  const stats = await getStats();
  const match = stats.matches[0];
  const sent = stats.clients.reduce((sum, c) => sum + c.bytesOut, 0);
  const row: Row = {
    n,
    entities: match?.entities ?? 0,
    tickP50: match?.tickMs?.p50 ?? 0,
    tickP95: match?.tickMs?.p95 ?? 0,
    tickP99: match?.tickMs?.p99 ?? 0,
    tickMax: match?.tickMs?.max ?? 0,
    overruns: match?.overruns ?? 0,
    elu: stats.elu,
    rssMb: stats.rssMb,
    outMBs: Math.round((sent / MEASURE_S / 1024 / 1024) * 100) / 100,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
  for (const ws of clients) ws.close();
  server.kill('SIGINT');
  await new Promise((r) => server.once('exit', r));
}

console.table(rows);
const limit = rows.find((r) => r.tickP99 > 33.3);
console.log(limit ? `крок довший за 33 мс (p99) з N = ${limit.n}` : 'у всіх N p99 кроку < 33 мс');
const outDir = path.resolve(serverDir, '../docs/load');
mkdirSync(outDir, { recursive: true });
// LOAD_LABEL=after npm run loadtest -> docs/load/after.json (графік бере before.json і after.json)
const file = path.join(outDir, `${process.env.LOAD_LABEL ?? 'latest'}.json`);
writeFileSync(file, JSON.stringify(rows, null, 2));
console.log('збережено', file);
