import { World } from 'shared/sim/world.js';
import { Ship } from 'shared/sim/ship.js';
import { ARENA } from 'shared/sim/arena.js';
import { DT, TICK_MS } from 'shared/sim/constants.js';
import { entityToRecord } from 'shared/protocol.js';
import { encodeSnapshot, withAck } from 'shared/codec/binary.js';
import { encodeSnapshotJson } from 'shared/codec/json.js';

const MAX_QUEUE = 10; // більше input у черзі одного гравця не тримаємо

// Матч кімнати: один справжній світ, який рахує лише сервер, 30 кроків на секунду.
// Гравці шлють лише input (кнопки), а сервер розсилає знімки стану.
export class Match {
  #timer = 0;
  #nextTickAt = 0;
  #lastTickStart = 0;

  constructor(room) {
    this.room = room;
    // seed може бути будь-яким - головне, що далі все рахується від нього
    this.seed = Math.floor(Math.random() * 2 ** 32);
    this.world = new World(ARENA, room.arena, this.seed);
    this.tick = 0;
    this.players = new Map(); // id гравця -> { player, ship, queue, lastSeq }
    this.stats = { tickMs: [], intervalMs: [], overruns: 0, droppedInputs: 0 };
  }

  // player: { id, name, codec, sendSnapshot(data), sendText(text) } - дає ws.js
  addPlayer(player) {
    const ship = this.world.spawn(
      new Ship(this.world.findSafeSpot(150), { playerId: player.id, name: player.name }),
    );
    this.players.set(player.id, { player, ship, queue: [], lastSeq: 0 });
    return ship;
  }

  removePlayer(id) {
    const entry = this.players.get(id);
    if (!entry) return;
    this.world.removeNow(entry.ship.id);
    this.players.delete(id);
  }

  // input уже перевірений (isValidInput). Старі й повторні seq пропускаємо.
  pushInput(id, input) {
    const entry = this.players.get(id);
    if (!entry || input.seq <= entry.lastSeq) return;
    if (entry.queue.length >= MAX_QUEUE) {
      this.stats.droppedInputs++;
      return;
    }
    entry.queue.push(input);
  }

  start() {
    this.#nextTickAt = performance.now();
    this.#lastTickStart = 0;
    this.#schedule();
  }

  stop() {
    clearTimeout(this.#timer);
  }

  // Не setInterval: він "пливе" і може склеювати виклики. Кожен крок має свій
  // абсолютний час nextTickAt, і ми чекаємо рівно до нього від поточного моменту.
  #schedule() {
    this.#nextTickAt += TICK_MS;
    const wait = Math.max(0, this.#nextTickAt - performance.now());
    this.#timer = setTimeout(() => this.#step(), wait);
  }

  #step() {
    const start = performance.now();
    if (this.#lastTickStart) remember(this.stats.intervalMs, start - this.#lastTickStart);
    this.#lastTickStart = start;

    // 1. input гравців, по порядку seq. Кожен input = один крок корабля,
    //    рівно так само, як клієнт прогнозує свій корабель.
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
    this.tick++;

    // 3. знімок і події кожному гравцю
    this.#broadcast();

    const took = performance.now() - start;
    remember(this.stats.tickMs, took);

    // якщо відстали більше ніж на крок - не наздоганяємо пачкою, а починаємо відлік заново
    if (performance.now() - this.#nextTickAt > TICK_MS) {
      this.stats.overruns++;
      this.#nextTickAt = performance.now();
    }
    this.#schedule();
  }

  #broadcast() {
    const entities = [];
    for (const e of this.world) {
      if (e.alive) entities.push(entityToRecord(e));
    }
    const binary = encodeSnapshot({ tick: this.tick, ack: 0, entities });
    const events =
      this.world.events.length > 0
        ? JSON.stringify({
            v: 0,
            type: 'events',
            tick: this.tick,
            list: this.world.events,
          })
        : null;

    for (const { player, lastSeq } of this.players.values()) {
      if (player.codec === 'json') {
        player.sendSnapshot(
          encodeSnapshotJson({ tick: this.tick, ack: lastSeq, entities }),
        );
      } else {
        player.sendSnapshot(withAck(binary, lastSeq));
      }
      if (events) player.sendText(events);
    }
  }

  statsJson() {
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
function remember(list, value) {
  list.push(value);
  if (list.length > 300) list.shift();
}

function summary(list) {
  if (list.length === 0) return null;
  const avg = list.reduce((a, b) => a + b, 0) / list.length;
  const sd = Math.sqrt(list.reduce((a, b) => a + (b - avg) ** 2, 0) / list.length);
  const round = (n) => Math.round(n * 100) / 100;
  return { avg: round(avg), max: round(Math.max(...list)), jitter: round(sd) };
}
