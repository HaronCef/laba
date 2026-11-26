import { World } from 'shared/sim/world.ts';
import { Ship } from 'shared/sim/ship.ts';
import { ARENA } from 'shared/sim/arena.ts';
import { DT, TICK_MS } from 'shared/sim/constants.ts';
import { entityToRecord } from 'shared/snapshot.ts';
import { serverMessage, type EntityRecord, type Input } from 'shared/protocol.ts';
import { pickCodec } from 'shared/codec/index.ts';
import { encodeSnapshot, withAck } from 'shared/codec/binary.ts';
import { Bot, type PlayerInput } from 'shared/sim/bot.ts';
import { asSeq, asTick, type PlayerId, type Seq, type Tick } from 'shared/types.ts';
import type { PlayerConn, Room } from './rooms.ts';

const MAX_QUEUE = 10; // більше input у черзі одного гравця не тримаємо

// Input людини: приходить по мережі в чергу, у кроці забираємо все по порядку seq
export class HumanInput implements PlayerInput {
  queue: Input[] = [];
  lastSeq: Seq = asSeq(0);
  dropped = 0;

  push(input: Input): void {
    if (input.seq <= this.lastSeq) return; // старий або повтор
    if (this.queue.length >= MAX_QUEUE) {
      this.dropped++;
      return;
    }
    this.queue.push(input);
  }

  take(_world: World, _ship: Ship): readonly Input[] {
    this.queue.sort((a, b) => a.seq - b.seq);
    const fresh: Input[] = [];
    for (const input of this.queue) {
      if (input.seq <= this.lastSeq) continue;
      fresh.push(input);
      this.lastSeq = input.seq;
    }
    this.queue = [];
    return fresh;
  }
}

interface MatchPlayer {
  readonly conn: PlayerConn;
  readonly ship: Ship;
  readonly input: HumanInput;
}

interface MatchBot {
  readonly name: string;
  readonly ship: Ship;
  readonly input: Bot;
}

interface Summary {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
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
  readonly bots: MatchBot[] = [];
  readonly stats = { tickMs: new Array<number>(), intervalMs: new Array<number>(), overruns: 0 };

  constructor(room: Room) {
    this.room = room;
    // seed може бути будь-яким - головне, що далі все рахується від нього
    this.seed = Math.floor(Math.random() * 2 ** 32);
    this.world = new World(ARENA, room.arena, this.seed);
  }

  addPlayer(conn: PlayerConn): Ship {
    const ship = this.world.spawn(new Ship(this.world.findSafeSpot(150), conn.name));
    this.players.set(conn.id, { conn, ship, input: new HumanInput() });
    return ship;
  }

  // бот керує кораблем через той самий PlayerInput, що й людина
  addBot(name: string): Ship {
    const ship = this.world.spawn(new Ship(this.world.findSafeSpot(150), name));
    this.bots.push({ name, ship, input: new Bot(this.seed + this.bots.length + 1) });
    return ship;
  }

  removeBots(): void {
    for (const bot of this.bots) this.world.removeNow(bot.ship.id);
    this.bots.length = 0;
  }

  removePlayer(id: PlayerId): void {
    const entry = this.players.get(id);
    if (!entry) return;
    this.world.removeNow(entry.ship.id);
    this.players.delete(id);
  }

  // input уже перевірений (Zod або бінарний декодер). Старі й повторні seq пропускаємо.
  pushInput(id: PlayerId, input: Input): void {
    this.players.get(id)?.input.push(input);
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

    // 1. input гравців і ботів. Кожен input = один крок корабля.
    for (const entry of this.players.values()) this.#applyInputs(entry.input, entry.ship);
    for (const bot of this.bots) this.#applyInputs(bot.input, bot.ship);

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

  #applyInputs(source: PlayerInput, ship: Ship): void {
    for (const input of source.take(this.world, ship)) ship.applyInput(input, this.world);
  }

  #broadcast(): void {
    const entities: EntityRecord[] = [];
    for (const e of this.world) {
      if (e.alive) entities.push(entityToRecord(e));
    }
    const events =
      this.world.events.length > 0 ? serverMessage({ type: 'events', tick: this.tick, list: this.world.events }) : null;

    // знімок у всіх однаковий, різниться лише ack - тому кодуємо один раз
    let binary: ArrayBuffer | null = null;
    for (const { conn, input } of this.players.values()) {
      if (conn.codec === 'binary') {
        binary ??= encodeSnapshot({ tick: this.tick, ack: asSeq(0), entities });
        conn.sendSnapshot(withAck(binary, input.lastSeq));
      } else {
        conn.sendSnapshot(pickCodec(conn.codec).encodeSnapshot({ tick: this.tick, ack: input.lastSeq, entities }));
      }
      if (events) conn.sendText(events);
    }
  }

  resetStats(): void {
    this.stats.tickMs.length = 0;
    this.stats.intervalMs.length = 0;
    this.stats.overruns = 0;
  }

  statsJson(): Record<string, unknown> {
    return {
      room: this.room.id,
      tick: this.tick,
      players: this.players.size,
      bots: this.bots.length,
      entities: this.world.size,
      tickMs: summary(this.stats.tickMs),
      intervalMs: summary(this.stats.intervalMs),
      overruns: this.stats.overruns,
      droppedInputs: [...this.players.values()].reduce((sum, p) => sum + p.input.dropped, 0),
    };
  }
}

// тримаємо останні 1800 значень (60 с)
function remember(list: number[], value: number): void {
  list.push(value);
  if (list.length > 1800) list.shift();
}

export function summary(list: readonly number[]): Summary | null {
  if (list.length === 0) return null;
  const avg = list.reduce((a, b) => a + b, 0) / list.length;
  const sd = Math.sqrt(list.reduce((a, b) => a + (b - avg) ** 2, 0) / list.length);
  const sorted = [...list].sort((a, b) => a - b);
  const round = (n: number): number => Math.round(n * 100) / 100;
  return {
    avg: round(avg),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1] ?? 0),
    jitter: round(sd),
  };
}

// p-й перцентиль відсортованого масиву (найближчий ранг)
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] ?? 0;
}
