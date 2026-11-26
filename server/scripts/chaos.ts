// Збої (лаба 8): npm run chaos --workspace=server
// 1) клієнт зникає посеред матчу (TCP рветься без close) - сервер прибирає його з кімнати;
// 2) "флудер" шле ~1000 битих кадрів/с - його відключають, а крок у кімнаті з гравцями не росте.
// (3-й збій - сервер убито - перевіряється в браузері, див. README.)
import { spawn } from 'node:child_process';
import path from 'node:path';
import WebSocket from 'ws';
import { encodeInput } from 'shared/codec/binary.ts';
import { asSeq } from 'shared/types.ts';

const PORT = 3450;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Metrics {
  players: number;
  tickP99Ms: number;
  rejections: Record<string, number>;
}
interface Stats {
  matches: Array<{ room: string; tickMs: { p99: number } | null }>;
}

const server = spawn(process.execPath, [...process.execArgv, 'src/index.ts'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'warn', MAX_CONN_PER_IP: '50' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
for (let i = 0; i < 50; i++) {
  if (await fetch(`${BASE}/health`).then((r) => r.ok, () => false)) break;
  await sleep(100);
}
const metrics = async (): Promise<Metrics> => (await (await fetch(`${BASE}/metrics`)).json()) as Metrics;
const roomP99 = async (room: string): Promise<number> => {
  const stats = (await (await fetch(`${BASE}/api/stats`)).json()) as Stats;
  return stats.matches.find((m) => m.room === room)?.tickMs?.p99 ?? 0;
};

function player(room: string, name: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  let seq = 0;
  ws.on('open', () => {
    ws.send(JSON.stringify({ v: 0, type: 'join', room, name }));
    const timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return clearInterval(timer);
      seq++;
      ws.send(encodeInput({ seq: asSeq(seq), turn: 1, thrust: true, fire: seq % 3 === 0, missile: false, flip: false }));
    }, 1000 / 30);
  });
  ws.on('error', () => {});
  return new Promise((resolve) => ws.on('open', () => resolve(ws)));
}

// ---------- 1. клієнт зник ----------
await fetch(`${BASE}/api/rooms/belt/bots`, { method: 'POST', body: JSON.stringify({ count: 8 }) });
const keeper = await player('belt', 'keeper');
const victim = await player('belt', 'victim');
await sleep(1000);
const before = (await metrics()).players;
const t0 = Date.now();
victim.terminate(); // рве TCP без close-кадру, як закрита вкладка чи падіння браузера
let gone = -1;
for (let i = 0; i < 100; i++) {
  if ((await metrics()).players < before) {
    gone = Date.now() - t0;
    break;
  }
  await sleep(20);
}
console.log(`1) клієнт зник: гравців ${before} -> ${(await metrics()).players}, сервер помітив за ${gone} мс`);

// ---------- 2. флуд битими кадрами ----------
await sleep(10_000); // 10 с спокійної гри в "belt" (8 ботів + keeper)
const calm = await roomP99('belt');
await fetch(`${BASE}/api/stats?reset=1`);

let sent = 0;
let kicked = 0;
const flood = async (): Promise<void> => {
  // шле сміття ~1000 разів на секунду; коли відключать - підключається знову
  while (Date.now() < floodUntil) {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.on('error', () => {});
    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ v: 0, type: 'join', room: 'training', name: 'flooder' }));
        const timer = setInterval(() => {
          for (let i = 0; i < 10; i++) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(Buffer.from([0xde, 0xad, 0xbe, 0xef, i])); // не input
              sent++;
            }
          }
        }, 10);
        ws.on('close', () => {
          clearInterval(timer);
          kicked++;
          resolve();
        });
      });
      ws.on('error', () => resolve());
    });
    await sleep(10);
  }
};
const floodUntil = Date.now() + 10_000;
await flood();
const stormy = await roomP99('belt');
const m = await metrics();
console.log(`2) флуд: надіслано ${sent} битих кадрів, флудера відключали ${kicked} разів`);
console.log(`   крок у "belt" p99: спокійно ${calm} мс, під час флуду ${stormy} мс`);
console.log(`   rejections: ${JSON.stringify(m.rejections)}`);

keeper.close();
server.kill('SIGTERM');
