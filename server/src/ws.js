import { WebSocketServer } from 'ws';
import { CLOSE, MAX_MESSAGE_BYTES, make, validate } from './protocol.js';

const JOIN_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 15000;
const MAX_MISSED_PONGS = 2;

// token bucket: у "відрі" до 10 жетонів, щосекунди додається 5.
// Кожне повідомлення забирає жетон. Жетонів немає -> закриваємо.
const BUCKET_SIZE = 10;
const REFILL_PER_SEC = 5;

// повільний клієнт: якщо в черзі на відправку стільки байтів,
// неважливе (чат) йому не шлемо, а якщо ще більше - закриваємо
const SLOW_BYTES = 64 * 1024;
const TOO_SLOW_BYTES = 1024 * 1024;

let nextPlayerId = 1;

export function createWsServer(server, rooms) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });
  const stats = { droppedForSlowClients: 0 };

  // ---------- відправка з урахуванням повільних клієнтів ----------

  function send(socket, data, { important = true } = {}) {
    if (socket.readyState !== socket.OPEN) return;
    const queued = socket.bufferedAmount;
    if (queued > TOO_SLOW_BYTES) {
      socket.close(CLOSE.SLOW_CLIENT, 'too slow');
      return;
    }
    if (queued > SLOW_BYTES && !important) {
      stats.droppedForSlowClients++;
      return;
    }
    socket.send(data);
  }

  function broadcast(room, data, options) {
    for (const player of room.players.values()) {
      send(player.socket, data, options);
    }
  }

  function closeWithError(socket, code, reason) {
    if (socket.state.closing) return;
    socket.state.closing = true;
    console.warn(`[ws] закриваю ${socket.state?.id ?? '?'}: ${code} ${reason}`);
    send(socket, make('error', { code, message: reason }));
    socket.close(code, reason);
  }

  // ---------- кімнати: розсилка roster і чату за їхніми подіями ----------

  function wireRoom(room) {
    const sendRoster = () => broadcast(room, make('roster', { players: room.roster() }));
    room.on('join', sendRoster);
    room.on('leave', sendRoster);
    room.on('chat', (player, text) => {
      broadcast(room, make('chat', { from: player.name, text, t: Date.now() }), {
        important: false,
      });
    });
  }

  for (const room of rooms.all()) wireRoom(room);
  rooms.on('room', wireRoom);

  // ---------- одне з'єднання ----------

  wss.on('connection', (socket, req) => {
    const state = {
      id: nextPlayerId++,
      player: null,
      room: null,
      missedPongs: 0,
      closing: false,
      tokens: BUCKET_SIZE,
      lastRefill: Date.now(),
    };
    socket.state = state;
    console.log(`[ws] підключився ${state.id} (${req.socket.remoteAddress})`);

    // без обробника 'error' помилка сокета звалила б увесь процес
    socket.on('error', (err) => {
      console.warn(`[ws] помилка сокета ${state.id}:`, err.message);
    });

    const joinTimer = setTimeout(() => {
      closeWithError(socket, CLOSE.JOIN_TIMEOUT, 'join timeout');
    }, JOIN_TIMEOUT_MS);

    socket.on('pong', () => {
      state.missedPongs = 0;
    });

    socket.on('message', (data, isBinary) => {
      if (state.closing) return; // вже закриваємо - решту ігноруємо
      if (!takeToken(state)) {
        closeWithError(socket, CLOSE.RATE_LIMIT, 'too many messages');
        return;
      }
      if (isBinary) {
        closeWithError(socket, CLOSE.BAD_MESSAGE, 'binary not supported');
        return;
      }
      const result = validate(data.toString('utf8'));
      if (!result.ok) {
        closeWithError(socket, result.code, result.reason);
        return;
      }
      handle(socket, state, result.msg, joinTimer);
    });

    socket.on('close', (code) => {
      clearTimeout(joinTimer);
      console.log(`[ws] відключився ${state.id} (код ${code})`);
      leaveRoom(state);
    });
  });

  function takeToken(state) {
    const now = Date.now();
    const passed = (now - state.lastRefill) / 1000;
    state.tokens = Math.min(BUCKET_SIZE, state.tokens + passed * REFILL_PER_SEC);
    state.lastRefill = now;
    if (state.tokens < 1) return false;
    state.tokens -= 1;
    return true;
  }

  function handle(socket, state, msg, joinTimer) {
    if (msg.type === 'join') {
      if (state.room) {
        closeWithError(socket, CLOSE.BAD_MESSAGE, 'already joined');
        return;
      }
      const room = rooms.get(msg.room);
      if (!room || room.isFull) {
        closeWithError(
          socket,
          CLOSE.ROOM_UNAVAILABLE,
          room ? 'room is full' : 'no such room',
        );
        return;
      }
      clearTimeout(joinTimer);
      state.player = { id: state.id, name: msg.name.trim(), socket };
      state.room = room;
      send(socket, make('joined', { room: room.toJSON(), you: state.id }));
      room.add(state.player); // 'join' -> roster усім
      return;
    }

    // усе інше - тільки після join
    if (!state.room) {
      closeWithError(socket, CLOSE.BAD_MESSAGE, 'join first');
      return;
    }

    if (msg.type === 'chat') {
      state.room.chat(state.player, msg.text.trim());
    } else if (msg.type === 'leave') {
      leaveRoom(state);
      socket.close(CLOSE.NORMAL, 'bye');
    }
  }

  function leaveRoom(state) {
    if (!state.room) return;
    const room = state.room;
    state.room = null;
    room.remove(state.player.id);
  }

  // ---------- heartbeat ----------

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      const state = socket.state;
      if (state.missedPongs >= MAX_MISSED_PONGS) {
        console.warn(`[ws] ${state.id} не відповідає на ping, розриваю`);
        socket.terminate();
        continue;
      }
      state.missedPongs++;
      socket.ping();
    }
  }, PING_INTERVAL_MS);

  function close() {
    clearInterval(heartbeat);
    for (const socket of wss.clients) {
      socket.close(CLOSE.SHUTDOWN, 'server shutdown');
    }
    return new Promise((resolve) => wss.close(() => resolve()));
  }

  return { wss, close, stats };
}
