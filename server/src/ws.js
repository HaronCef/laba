import { WebSocketServer } from 'ws';
import { decodeInput } from 'shared/codec/binary.js';
import { isValidInput } from 'shared/protocol.js';
import { CLOSE, MAX_MESSAGE_BYTES, make, validate } from './protocol.js';
import { NO_NETSIM, throughNetsim } from './netsim.js';

const JOIN_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 15000;
const MAX_MISSED_PONGS = 2;

// token bucket: у "відрі" N жетонів, щосекунди додається M. Кожне повідомлення забирає жетон.
// Для input окреме відро: клієнт законно шле їх 30 на секунду.
const CHAT_BUCKET = { size: 10, refill: 5 };
const INPUT_BUCKET = { size: 45, refill: 35 };

// повільний клієнт: якщо в черзі на відправку стільки байтів,
// неважливе (чат, знімки) йому не шлемо, а якщо ще більше - закриваємо
const SLOW_BYTES = 64 * 1024;
const TOO_SLOW_BYTES = 1024 * 1024;

let nextPlayerId = 1;

function makeBucket({ size }) {
  return { tokens: size, last: Date.now() };
}

function takeToken(bucket, { size, refill }) {
  const now = Date.now();
  bucket.tokens = Math.min(size, bucket.tokens + ((now - bucket.last) / 1000) * refill);
  bucket.last = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export function createWsServer(server, rooms) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });
  const stats = { droppedForSlowClients: 0 };

  // ---------- відправка з урахуванням повільних клієнтів і штучної мережі ----------

  function send(socket, data, { important = true, droppable = false } = {}) {
    const state = socket.state;
    throughNetsim(
      state.net,
      () => {
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
        state.bytesOut +=
          typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
        socket.send(data);
      },
      { droppable },
    );
  }

  function broadcast(room, data, options) {
    for (const player of room.players.values()) {
      send(player.socket, data, options);
    }
  }

  function closeWithError(socket, code, reason) {
    if (socket.state.closing) return;
    socket.state.closing = true;
    console.warn(`[ws] закриваю ${socket.state.id}: ${code} ${reason}`);
    if (socket.readyState === socket.OPEN) {
      socket.send(make('error', { code, message: reason }));
      socket.close(code, reason);
    }
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
      chatBucket: makeBucket(CHAT_BUCKET),
      inputBucket: makeBucket(INPUT_BUCKET),
      net: NO_NETSIM,
      bytesIn: 0,
      bytesOut: 0,
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
      state.bytesIn += data.length;

      // бінарне повідомлення може бути лише input
      if (isBinary) {
        if (!takeToken(state.inputBucket, INPUT_BUCKET)) {
          closeWithError(socket, CLOSE.RATE_LIMIT, 'too many inputs');
          return;
        }
        let input;
        try {
          input = decodeInput(data);
        } catch (err) {
          closeWithError(socket, CLOSE.BAD_MESSAGE, `bad binary input: ${err.message}`);
          return;
        }
        if (!isValidInput(input)) {
          closeWithError(socket, CLOSE.BAD_MESSAGE, 'bad input values');
          return;
        }
        receiveInput(state, input);
        return;
      }

      const result = validate(data.toString('utf8'));
      if (!result.ok) {
        closeWithError(socket, result.code, result.reason);
        return;
      }
      const msg = result.msg;
      const bucket = msg.type === 'input' ? INPUT_BUCKET : CHAT_BUCKET;
      if (
        !takeToken(msg.type === 'input' ? state.inputBucket : state.chatBucket, bucket)
      ) {
        closeWithError(socket, CLOSE.RATE_LIMIT, 'too many messages');
        return;
      }
      handle(socket, state, msg, joinTimer);
    });

    socket.on('close', (code) => {
      clearTimeout(joinTimer);
      console.log(`[ws] відключився ${state.id} (код ${code})`);
      leaveRoom(state);
    });
  });

  // input теж проходить через штучну мережу (і може "загубитись")
  function receiveInput(state, input) {
    if (!state.room) return;
    const room = state.room;
    throughNetsim(state.net, () => room.match?.pushInput(state.id, input), {
      droppable: true,
    });
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
      if (msg.net) state.net = msg.net;
      state.player = {
        id: state.id,
        name: msg.name.trim(),
        socket,
        codec: msg.codec || 'binary',
        sendSnapshot: (data) => send(socket, data, { important: false, droppable: true }),
        sendText: (text) => send(socket, text),
      };
      state.room = room;
      room.add(state.player); // створює корабель у матчі і шле roster усім
      send(
        socket,
        make('joined', {
          room: room.toJSON(),
          you: state.id,
          shipId: state.player.ship.netId,
          seed: room.match.seed,
          tick: room.match.tick,
        }),
      );
      return;
    }

    if (msg.type === 'ping') {
      // відповідаємо через ту саму штучну мережу, тому RTT включає затримку
      throughNetsim(state.net, () => send(socket, make('pong', { t: msg.t })));
      return;
    }

    if (msg.type === 'netsim') {
      state.net = { lag: msg.lag, jitter: msg.jitter, drop: msg.drop };
      console.log(`[ws] ${state.id}: netsim`, state.net);
      return;
    }

    // усе інше - тільки після join
    if (!state.room) {
      closeWithError(socket, CLOSE.BAD_MESSAGE, 'join first');
      return;
    }

    if (msg.type === 'input') {
      const { seq, turn, thrust, fire, missile, flip } = msg;
      receiveInput(state, { seq, turn, thrust, fire, missile, flip });
    } else if (msg.type === 'chat') {
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

  // для /api/stats: байти кожного клієнта
  function clientStats() {
    return [...wss.clients].map((s) => ({
      id: s.state.id,
      name: s.state.player?.name ?? null,
      room: s.state.room?.id ?? null,
      codec: s.state.player?.codec ?? null,
      bytesIn: s.state.bytesIn,
      bytesOut: s.state.bytesOut,
      net: s.state.net,
    }));
  }

  return { wss, close, stats, clientStats };
}
