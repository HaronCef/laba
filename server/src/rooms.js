import { EventEmitter } from 'node:events';
import { startMatchLog } from './log/matchlog.js';

// Кімната. Події:
//   'join'  (player)        'leave' (player)        'chat' (player, text)
//   'empty' ()              - пішов останній гравець
//   'event' ({ t, type, ...}) - те саме, але одним об'єктом для логу матчу
//   'closed' ()             - кімнату прибрали, лог можна закривати
export class Room extends EventEmitter {
  constructor({ id, name, maxPlayers, arena = {}, permanent = false }) {
    super();
    this.id = id;
    this.name = name;
    this.maxPlayers = maxPlayers;
    this.arena = arena;
    this.permanent = permanent; // стандартні кімнати не видаляються
    this.players = new Map(); // id гравця -> { id, name, socket }
  }

  get isFull() {
    return this.players.size >= this.maxPlayers;
  }

  #log(type, fields) {
    this.emit('event', { t: Date.now(), room: this.id, type, ...fields });
  }

  add(player) {
    this.players.set(player.id, player);
    this.emit('join', player);
    this.#log('join', { player: player.id, name: player.name });
  }

  remove(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    this.players.delete(playerId);
    this.emit('leave', player);
    this.#log('leave', { player: player.id, name: player.name });
    if (this.players.size === 0) {
      this.emit('empty');
    }
  }

  chat(player, text) {
    this.emit('chat', player, text);
    this.#log('chat', { player: player.id, text });
  }

  roster() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name }));
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      players: this.players.size,
      maxPlayers: this.maxPlayers,
      arena: this.arena,
    };
  }
}

const DEFAULT_ROOMS = [
  {
    id: 'training',
    name: 'Тренування',
    arena: { waveBase: 2, hunterEvery: 0, pickupEvery: 5 },
  },
  {
    id: 'belt',
    name: 'Пояс астероїдів',
    arena: { waveBase: 5, hunterEvery: 3, pickupEvery: 8 },
  },
  {
    id: 'hunters',
    name: 'Мисливці',
    arena: { waveBase: 4, hunterEvery: 1, pickupEvery: 10 },
  },
];

let nextRoomNumber = 1;

// Менеджер кімнат. Сам теж EventEmitter: подія 'room' - з'явилась нова кімната
// (на неї підписується ws.js, щоб розсилати roster і чат).
export class RoomManager extends EventEmitter {
  #rooms = new Map();
  #logging = new Set(); // id кімнат, у яких зараз пишеться лог
  #pendingLogs = new Set(); // проміси pipeline, яких треба дочекатись при вимкненні

  constructor({ maxRooms, maxPlayersPerRoom, logDir }) {
    super();
    this.maxRooms = maxRooms;
    this.maxPlayersPerRoom = maxPlayersPerRoom;
    this.logDir = logDir;
    for (const preset of DEFAULT_ROOMS) {
      this.#add(new Room({ ...preset, maxPlayers: maxPlayersPerRoom, permanent: true }));
    }
  }

  #add(room) {
    this.#rooms.set(room.id, room);

    // Лог матчу: починається з першим гравцем, закінчується, коли кімната спорожніла.
    // Обробник 'join' спрацьовує раніше за подію 'event' про вхід, тож вона потрапить у лог.
    room.on('join', () => {
      if (this.#logging.has(room.id)) return;
      this.#logging.add(room.id);
      const done = startMatchLog(room, this.logDir)
        .catch((err) => console.error(`[log] ${room.id}:`, err))
        .finally(() => this.#pendingLogs.delete(done));
      this.#pendingLogs.add(done);
    });

    room.on('empty', () => {
      this.#logging.delete(room.id);
      if (!room.permanent) this.delete(room.id);
    });

    this.emit('room', room);
  }

  list() {
    return [...this.#rooms.values()].map((room) => room.toJSON());
  }

  get(id) {
    return this.#rooms.get(id);
  }

  all() {
    return [...this.#rooms.values()];
  }

  get size() {
    return this.#rooms.size;
  }

  // повертає кімнату або null, якщо вже забагато кімнат
  create({ name, maxPlayers }) {
    if (this.#rooms.size >= this.maxRooms) return null;
    const room = new Room({
      id: `room-${nextRoomNumber++}`,
      name,
      maxPlayers: Math.min(maxPlayers, this.maxPlayersPerRoom),
      arena: { waveBase: 3, hunterEvery: 3, pickupEvery: 8 },
    });
    this.#add(room);

    // якщо в нову кімнату так ніхто й не зайшов - прибираємо через хвилину
    setTimeout(() => {
      if (room.players.size === 0 && !room.permanent) this.delete(room.id);
    }, 60000).unref();
    return room;
  }

  delete(id) {
    const room = this.#rooms.get(id);
    if (!room) return;
    this.#rooms.delete(id);
    this.#logging.delete(id);
    room.emit('closed'); // лог матчу закінчиться і допишеться у файл
  }

  // при вимкненні сервера: закрити всі кімнати і дочекатись, поки логи запишуться
  async closeAll() {
    for (const id of [...this.#rooms.keys()]) {
      this.delete(id);
    }
    await Promise.allSettled([...this.#pendingLogs]);
  }
}
