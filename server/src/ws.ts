import type { Server } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { decodeInput } from 'shared/codec/binary.ts';
import { CLOSE, parseClientMessage, serverMessage, type ClientMessage, type Input, type Netsim } from 'shared/protocol.ts';
import { asPlayerId, assertNever, type PlayerId } from 'shared/types.ts';
import { NO_NETSIM, throughNetsim } from './netsim.ts';
import type { PlayerConn, Room, RoomManager } from './rooms.ts';
import { TokenBucket } from './tokenBucket.ts';
import { log } from './logger.ts';
import { counters, reasonOf, reject } from './metrics.ts';
import { clientIp, originAllowed } from './origin.ts';
import { startHeartbeat } from './heartbeat.ts';

const MAX_MESSAGE_BYTES = 2048; // maxPayload для ws
const JOIN_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 15000;
const MAX_MISSED_PONGS = 2;

// token bucket (tokenBucket.ts): розмір відра і скільки жетонів додається за секунду
const CHAT_BUCKET = { size: 10, refill: 5 };
const INPUT_BUCKET = { size: 45, refill: 35 }; // клієнт законно шле 30 input/с

// повільний клієнт: неважливе (чат, знімки) не шлемо, а якщо зовсім не встигає - закриваємо
const SLOW_BYTES = 64 * 1024;
const TOO_SLOW_BYTES = 1024 * 1024;

// Стан одного з'єднання. У JS я дописував його прямо в об'єкт сокета (socket.state = ...),
// TypeScript на це сказав "у WebSocket немає поля state" - тепер він живе в окремій Map.
interface ConnState {
  readonly id: PlayerId;
  readonly socket: WebSocket;
  conn: PlayerConn | null;
  room: Room | null;
  missedPongs: number;
  closing: boolean;
  readonly chatBucket: TokenBucket;
  readonly inputBucket: TokenBucket;
  net: Netsim;
  bytesIn: number;
  bytesOut: number;
}

interface SendOptions {
  important?: boolean;
  droppable?: boolean;
}

let nextPlayerId = 1;

// ws може дати Buffer, ArrayBuffer або масив Buffer (якщо повідомлення прийшло шматками).
// У JS я рахував data.length - для ArrayBuffer це було б undefined, і лічильник став би NaN.
function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

export interface WsOptions {
  readonly allowedOrigins: readonly string[];
  readonly maxConnPerIp: number;
  readonly trustProxy: boolean;
}

export function createWsServer(server: Server, rooms: RoomManager, options: WsOptions) {
  const perIp = new Map<string, number>(); // скільки з'єднань з кожної IP

  // перевірка ще до того, як з'єднання стане WebSocket: Origin і ліміт на IP
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: (info, done) => {
      if (!originAllowed(info.origin || undefined, info.req.headers.host, options.allowedOrigins)) {
        reject('origin');
        log.warn({ origin: info.origin }, 'чужий Origin, не пускаю');
        done(false, 403, 'origin not allowed');
        return;
      }
      const ip = clientIp(info.req, options.trustProxy);
      if ((perIp.get(ip) ?? 0) >= options.maxConnPerIp) {
        reject('ip-limit');
        log.warn('забагато з\'єднань з однієї IP');
        done(false, 429, 'too many connections');
        return;
      }
      done(true);
    },
  });
  const states = new Map<WebSocket, ConnState>();
  const stats = { droppedForSlowClients: 0 };

  // ---------- відправка з урахуванням повільних клієнтів і штучної мережі ----------

  function send(state: ConnState, data: string | ArrayBuffer, { important = true, droppable = false }: SendOptions = {}): void {
    throughNetsim(
      state.net,
      () => {
        const socket = state.socket;
        if (socket.readyState !== WebSocket.OPEN) return;
        const queued = socket.bufferedAmount;
        if (queued > TOO_SLOW_BYTES) {
          reject('slow-client');
          socket.close(CLOSE.SLOW_CLIENT, 'too slow');
          return;
        }
        if (queued > SLOW_BYTES && !important) {
          stats.droppedForSlowClients++;
          return;
        }
        const size = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
        state.bytesOut += size;
        counters.bytesOut += size;
        socket.send(data);
      },
      { droppable },
    );
  }

  function closeWithError(state: ConnState, code: number, reason: string): void {
    if (state.closing) return;
    state.closing = true;
    reject(reasonOf(code));
    log.warn({ playerId: state.id, roomId: state.room?.id, code, reason }, 'закриваю з\'єднання');
    if (state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(serverMessage({ type: 'error', code, message: reason }));
      state.socket.close(code, reason.slice(0, 120)); // reason у кадрі close - до 123 байт
    }
  }

  // ---------- кімнати: розсилка roster і чату за їхніми подіями ----------

  function wireRoom(room: Room): void {
    const sendRoster = (): void => {
      const text = serverMessage({ type: 'roster', players: room.roster() });
      for (const { conn } of room.players.values()) conn.sendText(text);
    };
    room.on('join', sendRoster);
    room.on('leave', sendRoster);
    room.on('bots', sendRoster);
    room.on('chat', (from, text) => {
      const msg = serverMessage({ type: 'chat', from: from.name, text, t: Date.now() });
      for (const member of room.players.values()) {
        const target = statesById.get(member.conn.id);
        if (target) send(target, msg, { important: false });
      }
    });
  }

  const statesById = new Map<PlayerId, ConnState>();
  for (const room of rooms.all()) wireRoom(room);
  rooms.on('room', wireRoom);

  // ---------- одне з'єднання ----------

  wss.on('connection', (socket, req) => {
    const state: ConnState = {
      id: asPlayerId(nextPlayerId++),
      socket,
      conn: null,
      room: null,
      missedPongs: 0,
      closing: false,
      chatBucket: new TokenBucket(CHAT_BUCKET.size, CHAT_BUCKET.refill),
      inputBucket: new TokenBucket(INPUT_BUCKET.size, INPUT_BUCKET.refill),
      net: NO_NETSIM,
      bytesIn: 0,
      bytesOut: 0,
    };
    states.set(socket, state);
    statesById.set(state.id, state);
    const ip = clientIp(req, options.trustProxy);
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    log.info({ playerId: state.id }, 'підключився');

    // без обробника 'error' помилка сокета звалила б увесь процес
    socket.on('error', (err) => {
      log.warn({ playerId: state.id, err: err.message }, 'помилка сокета');
    });

    const joinTimer = setTimeout(() => {
      closeWithError(state, CLOSE.JOIN_TIMEOUT, 'join timeout');
    }, JOIN_TIMEOUT_MS);

    socket.on('pong', () => {
      state.missedPongs = 0;
    });

    socket.on('message', (data, isBinary) => {
      if (state.closing) return; // вже закриваємо - решту ігноруємо
      const bytes = toBuffer(data);
      state.bytesIn += bytes.length;
      counters.messagesIn++;
      counters.bytesIn += bytes.length;

      // бінарне повідомлення може бути лише input; декодер сам перевіряє довжину, версію, діапазони
      if (isBinary) {
        if (!state.inputBucket.take()) {
          closeWithError(state, CLOSE.RATE_LIMIT, 'too many inputs');
          return;
        }
        const input = decodeInput(bytes);
        if (!input.ok) {
          closeWithError(state, CLOSE.BAD_MESSAGE, `bad binary input: ${input.error}`);
          return;
        }
        receiveInput(state, input.value);
        return;
      }

      // текст: unknown -> Zod. Винятків немає: або повідомлення, або код закриття.
      const parsed = parseClientMessage(bytes.toString('utf8'));
      if (!parsed.ok) {
        closeWithError(state, parsed.error.code, parsed.error.reason);
        return;
      }
      const msg = parsed.value;
      const isInput = msg.type === 'input';
      if (!(isInput ? state.inputBucket : state.chatBucket).take()) {
        closeWithError(state, CLOSE.RATE_LIMIT, 'too many messages');
        return;
      }
      handle(state, msg, joinTimer);
    });

    socket.on('close', (code) => {
      clearTimeout(joinTimer);
      log.info({ playerId: state.id, roomId: state.room?.id, code }, 'відключився');
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left > 0) perIp.set(ip, left);
      else perIp.delete(ip);
      leaveRoom(state);
      states.delete(socket);
      statesById.delete(state.id);
    });
  });

  // input теж проходить через штучну мережу (і може "загубитись")
  function receiveInput(state: ConnState, input: Input): void {
    const room = state.room;
    if (!room) return;
    throughNetsim(state.net, () => room.match?.pushInput(state.id, input), { droppable: true });
  }

  function handle(state: ConnState, msg: ClientMessage, joinTimer: NodeJS.Timeout): void {
    switch (msg.type) {
      case 'join':
        return join(state, msg, joinTimer);
      case 'ping':
        // відповідаємо через ту саму штучну мережу, тому RTT включає затримку
        throughNetsim(state.net, () => send(state, serverMessage({ type: 'pong', t: msg.t })));
        return;
      case 'netsim':
        state.net = { lag: msg.lag, jitter: msg.jitter, drop: msg.drop };
        log.debug({ playerId: state.id, net: state.net }, 'netsim');
        return;
      case 'input':
      case 'chat':
      case 'leave':
        return inRoom(state, msg);
      default:
        assertNever(msg); // новий тип повідомлення без обробника - помилка tsc
    }
  }

  function join(state: ConnState, msg: Extract<ClientMessage, { type: 'join' }>, joinTimer: NodeJS.Timeout): void {
    if (state.room) {
      closeWithError(state, CLOSE.BAD_MESSAGE, 'already joined');
      return;
    }
    const room = rooms.get(msg.room);
    if (!room || room.isFull) {
      closeWithError(state, CLOSE.ROOM_UNAVAILABLE, room ? 'room is full' : 'no such room');
      return;
    }
    clearTimeout(joinTimer);
    if (msg.net) state.net = msg.net;
    const conn: PlayerConn = {
      id: state.id,
      name: msg.name,
      codec: msg.codec ?? 'binary',
      sendSnapshot: (data) => send(state, data, { important: false, droppable: true }),
      sendText: (text) => send(state, text),
    };
    state.conn = conn;
    state.room = room;
    const { ship, match } = room.add(conn); // створює корабель у матчі і шле roster усім
    send(
      state,
      serverMessage({
        type: 'joined',
        room: room.toJSON(),
        you: state.id,
        shipId: ship.netId,
        seed: match.seed,
        tick: match.tick,
      }),
    );
  }

  // повідомлення, які мають сенс лише після join
  function inRoom(state: ConnState, msg: Extract<ClientMessage, { type: 'input' | 'chat' | 'leave' }>): void {
    const { room, conn } = state;
    if (!room || !conn) {
      closeWithError(state, CLOSE.BAD_MESSAGE, 'join first');
      return;
    }
    switch (msg.type) {
      case 'input': {
        const { seq, turn, thrust, fire, missile, flip } = msg;
        receiveInput(state, { seq, turn, thrust, fire, missile, flip });
        return;
      }
      case 'chat':
        room.chat(conn, msg.text);
        return;
      case 'leave':
        leaveRoom(state);
        state.socket.close(CLOSE.NORMAL, 'bye');
        return;
      default:
        assertNever(msg);
    }
  }

  function leaveRoom(state: ConnState): void {
    const room = state.room;
    if (!room) return;
    state.room = null;
    room.remove(state.id);
  }

  // ---------- heartbeat ----------

  // сам цикл - у heartbeat.ts (там його тестуємо з фейковими таймерами)
  const stopHeartbeat = startHeartbeat(() => states.values(), {
    intervalMs: PING_INTERVAL_MS,
    maxMissed: MAX_MISSED_PONGS,
  });

  // вимкнення: кожному "shutdown" і close 1001, півсекунди чекаємо відповіді, решту рвемо
  async function close(): Promise<void> {
    stopHeartbeat();
    for (const socket of wss.clients) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(serverMessage({ type: 'shutdown', reason: 'server restart' }));
        socket.close(CLOSE.SHUTDOWN, 'server shutdown');
      }
    }
    if (wss.clients.size > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }

  // для /api/stats: байти кожного клієнта
  function clientStats(): Array<Record<string, unknown>> {
    return [...states.values()].map((s) => ({
      id: s.id,
      name: s.conn?.name ?? null,
      room: s.room?.id ?? null,
      codec: s.conn?.codec ?? null,
      bytesIn: s.bytesIn,
      bytesOut: s.bytesOut,
      net: s.net,
    }));
  }

  function resetBytes(): void {
    for (const s of states.values()) {
      s.bytesIn = 0;
      s.bytesOut = 0;
    }
  }

  return { wss, close, stats, clientStats, resetBytes };
}
