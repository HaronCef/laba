import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { loadConfig } from './config.ts';
import { RoomManager } from './rooms.ts';
import { createWsServer } from './ws.ts';
import { serveStatic } from './static.ts';
import { listReplays, readEvents, replayPath } from './log/replay.ts';
import type { LogEvent } from './log/logEvent.ts';

const MAX_BODY_BYTES = 1024;

const loaded = loadConfig();
if (!loaded.ok) {
  console.error(`[config] ${loaded.error}`);
  process.exit(1);
}
const config = loaded.value;

const rooms = new RoomManager(config);

// ---------- допоміжне ----------

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

// помилка з HTTP-статусом (у JS я дописував err.status у звичайний Error - TypeScript не дав)
class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// читає тіло POST, але не більше limit байтів
async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > limit) throw new HttpError(413, 'body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ---------- маршрути API ----------

// Тіло POST /api/rooms - теж вхід ззовні, тому Zod (раніше тут була ручна перевірка)
const CreateRoomSchema = z.object({
  name: z.string().trim().min(1, 'name: від 1 до 24 символів').max(24, 'name: від 1 до 24 символів'),
  maxPlayers: z.number().int().min(2).max(8).default(4),
});

// POST /api/rooms/:id/bots {"count": 8} - додати ботів; DELETE - прибрати всіх
const AddBotsSchema = z.object({ count: z.number().int().min(1).max(16) });

async function addBots(req: IncomingMessage, res: ServerResponse, roomId: string): Promise<void> {
  const room = rooms.get(roomId);
  if (!room) {
    sendJson(res, 404, { error: 'no such room' });
    return;
  }
  if (req.method === 'DELETE') {
    room.removeBots();
    sendJson(res, 200, { bots: 0 });
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readBody(req, MAX_BODY_BYTES));
  } catch {
    sendJson(res, 400, { error: 'invalid JSON' });
    return;
  }
  const parsed = AddBotsSchema.safeParse(raw);
  if (!parsed.success) {
    sendJson(res, 400, { error: 'count: від 1 до 16' });
    return;
  }
  sendJson(res, 200, { bots: room.addBots(parsed.data.count) });
}

async function createRoom(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readBody(req, MAX_BODY_BYTES));
  } catch (err: unknown) {
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 400, { error: 'invalid JSON' });
    return;
  }

  const parsed = CreateRoomSchema.safeParse(raw);
  if (!parsed.success) {
    sendJson(res, 400, { error: parsed.error.issues[0]?.message ?? 'bad body' });
    return;
  }

  const room = rooms.create(parsed.data);
  if (!room) {
    sendJson(res, 503, { error: 'забагато кімнат' });
    return;
  }
  sendJson(res, 201, room.toJSON());
}

// Віддає файл логу потоком. pipeline читає файл шматками по 64 КБ і чекає,
// поки клієнт прийме попереднє (backpressure), тому пам'ять не росте.
async function streamReplay(res: ServerResponse, name: string): Promise<void> {
  const file = replayPath(config.logDir, name);
  const info = file ? await stat(file).catch(() => null) : null;
  if (!file || !info) {
    sendJson(res, 404, { error: 'no such replay' });
    return;
  }
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'content-length': info.size });
  await pipeline(createReadStream(file), res);
}

// Перші N подій логу. readEvents - async-генератор, і коли ми виходимо з for await
// раніше, він сам закриває потік файлу.
async function replayEvents(res: ServerResponse, name: string, limit: number): Promise<void> {
  const file = replayPath(config.logDir, name);
  if (!file || !(await stat(file).catch(() => null))) {
    sendJson(res, 404, { error: 'no such replay' });
    return;
  }
  const events: LogEvent[] = [];
  for await (const event of readEvents(file)) {
    events.push(event);
    if (events.length >= limit) break;
  }
  sendJson(res, 200, events);
}

// Демо для README (лаба 4): зайняти цикл подій на ms мілісекунд
function busyWait(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // синхронно тримаємо єдиний потік - весь сервер стоїть
  }
}

let lastElu = performance.eventLoopUtilization();

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;

  if (req.method === 'GET' && p === '/health') {
    const mem = process.memoryUsage();
    sendJson(res, 200, {
      ok: true,
      uptime: Math.round(process.uptime()),
      rooms: rooms.size,
      connections: ws.wss.clients.size,
      rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
    });
    return;
  }
  if (req.method === 'GET' && p === '/api/stats') {
    // ?reset=1 - скинути статистику (для load test)
    if (url.searchParams.get('reset') === '1') {
      for (const room of rooms.all()) room.match?.resetStats();
      ws.resetBytes();
      lastElu = performance.eventLoopUtilization();
      sendJson(res, 200, { reset: true });
      return;
    }
    // статистика матчів, клієнтів і процесу
    const elu = performance.eventLoopUtilization(lastElu);
    lastElu = performance.eventLoopUtilization();
    const mem = process.memoryUsage();
    sendJson(res, 200, {
      elu: Math.round(elu.utilization * 1000) / 1000, // наскільки зайнятий event loop (0..1)
      rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heapMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      matches: rooms.all().flatMap((r) => (r.match ? [r.match.statsJson()] : [])),
      clients: ws.clientStats(),
    });
    return;
  }
  if (p === '/api/rooms') {
    if (req.method === 'GET') return sendJson(res, 200, rooms.list());
    if (req.method === 'POST') return createRoom(req, res);
    res.writeHead(405, { allow: 'GET, POST' });
    res.end();
    return;
  }
  const botsPath = p.match(/^\/api\/rooms\/([a-z0-9-]+)\/bots$/);
  if (botsPath && botsPath[1]) {
    if (req.method === 'POST' || req.method === 'DELETE') return addBots(req, res, botsPath[1]);
    res.writeHead(405, { allow: 'POST, DELETE' });
    res.end();
    return;
  }
  if (req.method === 'GET' && p === '/api/replays') {
    sendJson(res, 200, await listReplays(config.logDir));
    return;
  }
  const replay = p.match(/^\/api\/replays\/([^/]+?)(\/events)?$/);
  // replay[1] з noUncheckedIndexedAccess має тип string | undefined - перевіряємо
  if (req.method === 'GET' && replay && replay[1]) {
    if (replay[2]) {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 1000);
      return replayEvents(res, replay[1], limit);
    }
    return streamReplay(res, replay[1]);
  }
  if (req.method === 'GET' && p === '/api/slow') {
    const ms = Math.min(Number(url.searchParams.get('ms')) || 300, 2000);
    busyWait(ms);
    sendJson(res, 200, { blockedMs: ms });
    return;
  }
  if (p.startsWith('/api/')) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (await serveStatic(req, res, config.staticDir, p)) return;
    // якщо такого файлу немає - віддаємо index.html (клієнт сам розбереться)
    if (await serveStatic(req, res, config.staticDir, '/index.html')) return;
    sendJson(res, 404, { error: 'client is not built: npm run build' });
    return;
  }
  res.writeHead(405);
  res.end();
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    // помилка в одному запиті не повинна звалити весь сервер
    if (err instanceof Error && 'code' in err && err.code === 'ERR_STREAM_PREMATURE_CLOSE') return; // клієнт перервав
    console.error('[http]', req.method, req.url, err);
    if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    else res.destroy();
  });
});

const ws = createWsServer(server, rooms);

// Без цього обробника зайнятий порт (EADDRINUSE) валив процес з "Unhandled 'error' event"
// (лог у README, лаба 4). Тепер - зрозуміле повідомлення і вихід з кодом 1.
function onServerError(err: unknown): void {
  if (err instanceof Error && 'code' in err && err.code === 'EADDRINUSE') {
    console.error(`[http] порт ${config.port} уже зайнятий. Закрий інший сервер або зміни PORT у .env`);
  } else {
    console.error('[http] помилка сервера:', err);
  }
  process.exit(1);
}
server.on('error', onServerError);
ws.wss.on('error', onServerError); // ws пересилає помилки http-сервера ще й на себе

server.listen(config.port, config.host, () => {
  console.log(`[http] слухаю http://${config.host}:${config.port}`);
  console.log(`[http] клієнт з ${config.staticDir}, логи в ${config.logDir}`);
});

// ---------- акуратне вимкнення ----------

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[http] отримав ${signal}, вимикаюсь...`);

  // якщо щось зависло - через 5 с виходимо примусово
  setTimeout(() => {
    console.error('[http] не встиг за 5 с, виходжу примусово');
    process.exit(1);
  }, 5000).unref();

  server.close(); // нові з'єднання більше не приймаємо
  await ws.close(); // усім сокетам код 1001
  server.closeIdleConnections();
  await rooms.closeAll(); // дописати логи матчів
  console.log('[http] логи дописані, бувай');
  process.exitCode = 0;
  setTimeout(() => server.closeAllConnections(), 100).unref();
}

process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));
