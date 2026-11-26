import { World } from 'shared/sim/world.ts';
import { Ship } from 'shared/sim/ship.ts';
import { ARENA } from 'shared/sim/arena.ts';
import { DT, TICK_MS } from 'shared/sim/constants.ts';
import { entityToRecord } from 'shared/snapshot.ts';
import { serverMessage, type EntityRecord, type Input } from 'shared/protocol.ts';
import { pickCodec } from 'shared/codec/index.ts';
import { asSeq, asTick, type PlayerId, type Seq, type Tick } from 'shared/types.ts';
import type { PlayerConn, Room } from './rooms.ts';

const MAX_QUEUE = 10; // більше input у черзі одного гравця не тримаємо

interface MatchPlayer {
  readonly conn: PlayerConn;
  readonly ship: Ship;
  queue: Input[];
  lastSeq: Seq;
}

interface Summary {
  avg: number;
  max: number;
  jitter: number;
}

// Матч кімнати: один справжній світ, який рахує лише сервер, 30 кроків на секунду.
// Гравці шлють лише input (кнопки), а сервер розсилає знімки стану.
export class Match {
  #timer: NodeJS.Timeout | undefined;
  #nextTickAt = 0;
  #lastTickStart = 0;

  readonly room: Room;
  readonly seed: number;
  readonly world: World;
  tick: Tick = asTick(0);
  readonly players = new Map<PlayerId, MatchPlayer>();
  readonly stats = {
    tickMs: new Array<number>(),
    intervalMs: new Array<number>(),
    overruns: 0,
    droppedInputs: 0,
  };

  constructor(room: Room) {
    this.room = room;
    // seed може бути будь-яким - головне, що далі все рахується від нього
    this.seed = Math.floor(Math.random() * 2 ** 32);
    this.world = new World(ARENA, room.arena, this.seed);
  }

  addPlayer(conn: PlayerConn): Ship {
    const ship = this.world.spawn(new Ship(this.world.findSafeSpot(150), conn.name));
    this.players.set(conn.id, { conn, ship, queue: [], lastSeq: asSeq(0) });
    return ship;
  }

  removePlayer(id: PlayerId): void {
    const entry = this.players.get(id);
    if (!entry) return;
    this.world.removeNow(entry.ship.id);
    this.players.delete(id);
  }

  // input уже перевірений (Zod або бінарний декодер). Старі й повторні seq пропускаємо.
  pushInput(id: PlayerId, input: Input): void {
    const entry = this.players.get(id);
    if (!entry || input.seq <= entry.lastSeq) return;
    if (entry.queue.length >= MAX_QUEUE) {
      this.stats.droppedInputs++;
      return;
    }
    entry.queue.push(input);
  }

  start(): void {
    this.#nextTickAt = performance.now();
    this.#lastTickStart = 0;
    this.#schedule();
  }

  stop(): void {
    clearTimeout(this.#timer);
  }

  // Не setInterval: він "пливе" і може склеювати виклики. Кожен крок має свій
  // абсолютний час nextTickAt, і ми чекаємо рівно до нього від поточного моменту.
  #schedule(): void {
    this.#nextTickAt += TICK_MS;
    const wait = Math.max(0, this.#nextTickAt - performance.now());
    this.#timer = setTimeout(() => this.#step(), wait);
  }

  #step(): void {
    const start = performance.now();
    if (this.#lastTickStart) remember(this.stats.intervalMs, start - this.#lastTickStart);
    this.#lastTickStart = start;

    // 1. input гравців, по порядку seq. Кожен input = один крок корабля.
    for (const entry of this.players.values()) {
      entry.queue.sort((a, b) => a.seq - b.seq);
      for (const input of entry.queue) {
        if (input.seq <= entry.lastSeq) continue;
        entry.ship.applyInput(input, this.world);
        entry.lastSeq = input.seq;
      }
      entry.queue = [];
    }

    // 2. крок світу
    this.world.step(DT);
    this.tick = asTick(this.tick + 1);

    // 3. знімок і події кожному гравцю
    this.#broadcast();

    remember(this.stats.tickMs, performance.now() - start);

    // якщо відстали більше ніж на крок - не наздоганяємо пачкою, а починаємо відлік заново
    if (performance.now() - this.#nextTickAt > TICK_MS) {
      this.stats.overruns++;
      this.#nextTickAt = performance.now();
    }
    this.#schedule();
  }

  #broadcast(): void {
    const entities: EntityRecord[] = [];
    for (const e of this.world) {
      if (e.alive) entities.push(entityToRecord(e));
    }
    const events =
      this.world.events.length > 0
        ? serverMessage({ type: 'events', tick: this.tick, list: this.world.events })
        : null;

    for (const { conn, lastSeq } of this.players.values()) {
      // знімок однаковий, різниться лише ack (lastProcessedSeq) кожного гравця
      conn.sendSnapshot(
        pickCodec(conn.codec).encodeSnapshot({ tick: this.tick, ack: lastSeq, entities }),
      );
      if (events) conn.sendText(events);
    }
  }

  statsJson(): Record<string, unknown> {
    return {
      room: this.room.id,
      tick: this.tick,
      players: this.players.size,
      entities: this.world.size,
      tickMs: summary(this.stats.tickMs),
      intervalMs: summary(this.stats.intervalMs),
      overruns: this.stats.overruns,
      droppedInputs: this.stats.droppedInputs,
    };
  }
}

// тримаємо останні 300 значень (10 с)
function remember(list: number[], value: number): void {
  list.push(value);
  if (list.length > 300) list.shift();
}

function summary(list: readonly number[]): Summary | null {
  if (list.length === 0) return null;
  const avg = list.reduce((a, b) => a + b, 0) / list.length;
  const sd = Math.sqrt(list.reduce((a, b) => a + (b - avg) ** 2, 0) / list.length);
  const round = (n: number): number => Math.round(n * 100) / 100;
  return { avg: round(avg), max: round(Math.max(...list)), jitter: round(sd) };
}
