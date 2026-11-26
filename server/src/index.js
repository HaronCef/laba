import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { loadConfig } from './config.js';
import { RoomManager } from './rooms.js';
import { createWsServer } from './ws.js';
import { serveStatic } from './static.js';
import { listReplays, readEvents, replayPath } from './log/replay.js';

const MAX_BODY_BYTES = 1024;

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`[config] ${err.message}`);
  process.exit(1);
}

const rooms = new RoomManager(config);

// ---------- допоміжне ----------

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

// читає тіло POST, але не більше limit байтів
async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const err = new Error('body too large');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ---------- маршрути API ----------

async function createRoom(req, res) {
  let data;
  try {
    data = JSON.parse(await readBody(req, MAX_BODY_BYTES));
  } catch (err) {
    sendJson(res, err.status || 400, {
      error: err.status ? err.message : 'invalid JSON',
    });
    return;
  }

  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  const maxPlayers = data?.maxPlayers ?? 4;
  if (name.length < 1 || name.length > 24) {
    sendJson(res, 400, { error: 'name: від 1 до 24 символів' });
    return;
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 8) {
    sendJson(res, 400, { error: 'maxPlayers: ціле число від 2 до 8' });
    return;
  }

  const room = rooms.create({ name, maxPlayers });
  if (!room) {
    sendJson(res, 503, { error: 'забагато кімнат' });
    return;
  }
  sendJson(res, 201, room.toJSON());
}

// Віддає файл логу потоком. pipeline читає файл шматками по 64 КБ і чекає,
// поки клієнт прийме попереднє (backpressure), тому пам'ять не росте.
async function streamReplay(req, res, name) {
  const file = replayPath(config.logDir, name);
  const info = file && (await stat(file).catch(() => null));
  if (!info) {
    sendJson(res, 404, { error: 'no such replay' });
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/x-ndjson',
    'content-length': info.size,
  });
  await pipeline(createReadStream(file), res);
}

// Перші N подій логу. readEvents - async-генератор, і коли ми виходимо з for await
// раніше, він сам закриває потік файлу.
async function replayEvents(res, name, limit) {
  const file = replayPath(config.logDir, name);
  if (!file || !(await stat(file).catch(() => null))) {
    sendJson(res, 404, { error: 'no such replay' });
    return;
  }
  const events = [];
  for await (const event of readEvents(file)) {
    events.push(event);
    if (events.length >= limit) break;
  }
  sendJson(res, 200, events);
}

// Демо для README: зайняти цикл подій на ms мілісекунд
function busyWait(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // синхронно тримаємо єдиний потік - весь сервер стоїть
  }
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
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
  if (p === '/api/rooms') {
    if (req.method === 'GET') return sendJson(res, 200, rooms.list());
    if (req.method === 'POST') return createRoom(req, res);
    res.writeHead(405, { allow: 'GET, POST' });
    res.end();
    return;
  }
  if (req.method === 'GET' && p === '/api/replays') {
    sendJson(res, 200, await listReplays(config.logDir));
    return;
  }
  const replay = p.match(/^\/api\/replays\/([^/]+?)(\/events)?$/);
  if (req.method === 'GET' && replay) {
    if (replay[2]) {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 1000);
      return replayEvents(res, replay[1], limit);
    }
    return streamReplay(req, res, replay[1]);
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
  route(req, res).catch((err) => {
    // помилка в одному запиті не повинна звалити весь сервер
    if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') return; // клієнт сам перервав завантаження
    console.error('[http]', req.method, req.url, err);
    if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    else res.destroy();
  });
});

const ws = createWsServer(server, rooms);

// Без цього обробника зайнятий порт (EADDRINUSE) валив процес з "Unhandled 'error' event"
// (лог у README). Тепер - зрозуміле повідомлення і вихід з кодом 1.
function onServerError(err) {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[http] порт ${config.port} уже зайнятий. Закрий інший сервер або зміни PORT у .env`,
    );
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

async function shutdown(signal) {
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

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
