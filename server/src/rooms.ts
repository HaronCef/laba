import { EventEmitter } from 'node:events';
import { startMatchLog } from './log/matchlog.ts';
import { Match } from './match.ts';
import type { LogEvent } from './log/logEvent.ts';
import type { Ship } from 'shared/sim/ship.ts';
import type { WorldConfig } from 'shared/sim/world.ts';
import { asPlayerId, type PlayerId } from 'shared/types.ts';
import type { CodecName } from 'shared/codec/index.ts';
import { log } from './logger.ts';
import type { RoomInfo } from 'shared/protocol.ts';

// Гравець з погляду кімнати: як з ним говорити, без подробиць WebSocket
export interface PlayerConn {
  readonly id: PlayerId;
  readonly name: string;
  readonly codec: CodecName;
  sendSnapshot(data: string | ArrayBuffer): void;
  sendText(text: string): void;
}

export interface Member {
  readonly conn: PlayerConn;
  readonly ship: Ship;
}

// Події кімнати з типами аргументів: emit('chat', player) без тексту - помилка tsc
export interface RoomEvents {
  join: [conn: PlayerConn];
  leave: [conn: PlayerConn];
  chat: [conn: PlayerConn, text: string];
  empty: [];
  event: [event: LogEvent];
  bots: [];
  closed: [];
}

export const MAX_BOTS = 16;

interface RoomOptions {
  id: string;
  name: string;
  maxPlayers: number;
  arena?: Partial<WorldConfig>;
  permanent?: boolean;
}

export class Room extends EventEmitter<RoomEvents> {
  readonly id: string;
  readonly name: string;
  readonly maxPlayers: number;
  readonly arena: Partial<WorldConfig>;
  readonly permanent: boolean; // стандартні кімнати не видаляються
  readonly players = new Map<PlayerId, Member>();
  match: Match | null = null; // гра йде, поки в кімнаті є хоч хтось

  constructor({ id, name, maxPlayers, arena = {}, permanent = false }: RoomOptions) {
    super();
    this.id = id;
    this.name = name;
    this.maxPlayers = maxPlayers;
    this.arena = arena;
    this.permanent = permanent;
  }

  get isFull(): boolean {
    return this.players.size >= this.maxPlayers;
  }

  #ensureMatch(): Match {
    if (this.match) return this.match;
    const match = new Match(this);
    this.match = match;
    match.start();
    return match;
  }

  // повертає корабель гравця і сам матч (щоб не перевіряти this.match на null ззовні)
  add(conn: PlayerConn): { ship: Ship; match: Match } {
    const match = this.#ensureMatch();
    const ship = match.addPlayer(conn);
    this.players.set(conn.id, { conn, ship });
    this.emit('join', conn);
    this.emit('event', { t: Date.now(), room: this.id, type: 'join', player: conn.id, name: conn.name });
    return { ship, match };
  }

  remove(playerId: PlayerId): void {
    const member = this.players.get(playerId);
    if (!member) return;
    this.players.delete(playerId);
    this.match?.removePlayer(playerId);
    this.emit('leave', member.conn);
    this.emit('event', { t: Date.now(), room: this.id, type: 'leave', player: playerId, name: member.conn.name });
    if (this.players.size === 0) {
      this.#stopMatch(); // боти без людей не грають
      this.emit('empty');
    }
  }

  // боти не займають місць людей, але їх не більше MAX_BOTS
  addBots(count: number): number {
    const match = this.#ensureMatch();
    const n = Math.max(0, Math.min(count, MAX_BOTS - match.bots.length));
    for (let i = 0; i < n; i++) match.addBot(`bot-${match.bots.length + 1}`);
    if (n > 0) this.emit('bots');
    return match.bots.length;
  }

  removeBots(): void {
    if (!this.match) return;
    this.match.removeBots();
    this.emit('bots');
    if (this.players.size === 0) this.#stopMatch();
  }

  #stopMatch(): void {
    this.match?.stop();
    this.match = null;
  }

  chat(conn: PlayerConn, text: string): void {
    this.emit('chat', conn, text);
    this.emit('event', { t: Date.now(), room: this.id, type: 'chat', player: conn.id, text });
  }

  roster(): Array<{ id: PlayerId; name: string; shipId: Ship['netId'] }> {
    const people = [...this.players.values()].map(({ conn, ship }) => ({ id: conn.id, name: conn.name, shipId: ship.netId }));
    // у ботів немає з'єднання, id для roster - умовний (0)
    const bots = (this.match?.bots ?? []).map((b) => ({ id: asPlayerId(0), name: b.name, shipId: b.ship.netId }));
    return [...people, ...bots];
  }

  toJSON(): RoomInfo {
    return {
      id: this.id,
      name: this.name,
      players: this.players.size,
      maxPlayers: this.maxPlayers,
      arena: this.arena,
    };
  }
}

const DEFAULT_ROOMS: RoomOptions[] = [
  { id: 'training', name: 'Тренування', maxPlayers: 8, arena: { waveBase: 2, hunterEvery: 0, pickupEvery: 5 } },
  { id: 'belt', name: 'Пояс астероїдів', maxPlayers: 8, arena: { waveBase: 5, hunterEvery: 3, pickupEvery: 8 } },
  { id: 'hunters', name: 'Мисливці', maxPlayers: 8, arena: { waveBase: 4, hunterEvery: 1, pickupEvery: 10 } },
];

let nextRoomNumber = 1;

interface ManagerEvents {
  room: [room: Room];
}

// Менеджер кімнат. Подія 'room' - з'явилась нова кімната
// (на неї підписується ws.ts, щоб розсилати roster і чат).
export class RoomManager extends EventEmitter<ManagerEvents> {
  readonly #rooms = new Map<string, Room>();
  readonly #logging = new Set<string>(); // id кімнат, у яких зараз пишеться лог
  readonly #pendingLogs = new Set<Promise<unknown>>(); // pipeline, яких треба дочекатись при вимкненні
  readonly maxRooms: number;
  readonly maxPlayersPerRoom: number;
  readonly logDir: string;

  constructor({ maxRooms, maxPlayersPerRoom, logDir }: { maxRooms: number; maxPlayersPerRoom: number; logDir: string }) {
    super();
    this.maxRooms = maxRooms;
    this.maxPlayersPerRoom = maxPlayersPerRoom;
    this.logDir = logDir;
    for (const preset of DEFAULT_ROOMS) {
      this.#add(new Room({ ...preset, maxPlayers: maxPlayersPerRoom, permanent: true }));
    }
  }

  #add(room: Room): void {
    this.#rooms.set(room.id, room);

    // Лог матчу: починається з першим гравцем, закінчується, коли кімната спорожніла.
    room.on('join', () => {
      if (this.#logging.has(room.id)) return;
      this.#logging.add(room.id);
      const done: Promise<unknown> = startMatchLog(room, this.logDir)
        .catch((err: unknown) => log.error({ roomId: room.id, err }, 'не вдалося записати лог матчу'))
        .finally(() => this.#pendingLogs.delete(done));
      this.#pendingLogs.add(done);
    });

    room.on('empty', () => {
      this.#logging.delete(room.id);
      if (!room.permanent) this.delete(room.id);
    });

    this.emit('room', room);
  }

  list(): RoomInfo[] {
    return [...this.#rooms.values()].map((room) => room.toJSON());
  }

  // Map.get: кімнати може не бути - тип Room | undefined змушує це перевірити
  get(id: string): Room | undefined {
    return this.#rooms.get(id);
  }

  all(): Room[] {
    return [...this.#rooms.values()];
  }

  get size(): number {
    return this.#rooms.size;
  }

  // повертає кімнату або null, якщо вже забагато кімнат
  create({ name, maxPlayers }: { name: string; maxPlayers: number }): Room | null {
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

  delete(id: string): void {
    const room = this.#rooms.get(id);
    if (!room) return;
    this.#rooms.delete(id);
    this.#logging.delete(id);
    room.match?.stop();
    room.match = null;
    room.emit('closed'); // лог матчу закінчиться і допишеться у файл
  }

  // при вимкненні сервера: закрити всі кімнати і дочекатись, поки логи запишуться
  async closeAll(): Promise<void> {
    for (const id of [...this.#rooms.keys()]) {
      this.delete(id);
    }
    await Promise.allSettled([...this.#pendingLogs]);
  }
}
