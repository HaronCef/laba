import { Vector2 } from './vector.js';
import { wrapPosition } from './arena.js';
import { Asteroid } from './asteroid.js';
import { Pickup } from './pickup.js';
import { makeHoming, homingSystem } from './components/homing.js';
import { findCollisions } from './collision.js';
import { handleCollision } from './rules.js';
import { mulberry32 } from '../rng.js';

const DEFAULT_CONFIG = { waveBase: 3, hunterEvery: 3, pickupEvery: 8 };

// Світ гри. Тепер його рахує лише сервер.
// Без DOM, без модулів Node, без Math.random() і Date.now():
// усі "випадкові" числа беруться з this.rng (mulberry32 з seed).
// Події кроку ('fired', 'hit', 'exploded', 'pickup', 'score') складаються в this.events,
// а сервер розсилає їх клієнтам (звук, вибухи, рахунок).
export class World {
  #entities = new Map(); // id -> Entity
  #toRemove = new Set(); // id тих, кого прибрати в кінці кроку
  #toAdd = []; // створені під час кроку, додаються в кінці
  #stepping = false;
  #usedNetIds = new Set();
  #nextNetId = 1;

  constructor(arena, config = {}, seed = 1) {
    this.arena = arena;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.wave = 0;
    this.pickupTimer = this.config.pickupEvery;
    this.events = [];
  }

  emit(type, fields = {}) {
    this.events.push({ type, ...fields });
  }

  // очки отримує корабель, чия куля влучила (0 - нікому)
  addScore(shipNetId, delta, pos) {
    const ship = this.byNetId(shipNetId);
    if (!ship || ship.kind !== 'ship') return;
    ship.score += delta;
    this.emit('score', { ship: shipNetId, score: ship.score, delta, x: pos.x, y: pos.y });
  }

  get size() {
    return this.#entities.size;
  }

  get(id) {
    return this.#entities.get(id);
  }

  byNetId(netId) {
    for (const entity of this.#entities.values()) {
      if (entity.netId === netId) return entity;
    }
    return null;
  }

  // netId - номер від 1 до 65535 для мережі (Uint16); зайняті пропускаємо
  #allocNetId() {
    while (this.#usedNetIds.has(this.#nextNetId)) {
      this.#nextNetId = (this.#nextNetId % 65535) + 1;
    }
    const id = this.#nextNetId;
    this.#nextNetId = (this.#nextNetId % 65535) + 1;
    this.#usedNetIds.add(id);
    return id;
  }

  // Якщо додати в Map прямо під час for...of, цикл пройде і по новій сутності
  // в цьому ж кроці. Тому під час step нові сутності чекають до кінця кроку.
  spawn(entity) {
    entity.netId = this.#allocNetId();
    if (this.#stepping) {
      this.#toAdd.push(entity);
    } else {
      this.#entities.set(entity.id, entity);
    }
    return entity;
  }

  // не видаляємо одразу, а лише позначаємо
  despawn(id) {
    const entity = this.#entities.get(id);
    if (entity) {
      entity.alive = false;
      this.#toRemove.add(id);
    }
  }

  // видалити одразу (гравець вийшов між кроками)
  removeNow(id) {
    const entity = this.#entities.get(id);
    if (!entity) return;
    this.#entities.delete(id);
    this.#usedNetIds.delete(entity.netId);
  }

  *[Symbol.iterator]() {
    yield* this.#entities.values();
  }

  *ofKind(kind) {
    for (const entity of this.#entities.values()) {
      if (entity.kind === kind && entity.alive) yield entity;
    }
  }

  countKind(kind) {
    return [...this.ofKind(kind)].length;
  }

  // Один крок. Кораблі рухаються не тут, а в Ship.applyInput (по одному разу на input).
  step(dt) {
    this.events = [];
    this.#stepping = true;

    homingSystem(this, dt);

    for (const entity of this) {
      if (!entity.alive) continue;
      entity.update(dt, this);
      entity.pos = wrapPosition(entity.pos, this.arena);
    }

    for (const [a, b] of findCollisions(this)) {
      handleCollision(this, a, b);
    }

    this.spawnStuff(dt);

    this.#stepping = false;
    this.#sweep();
  }

  #sweep() {
    for (const id of this.#toRemove) {
      const entity = this.#entities.get(id);
      if (entity) this.#usedNetIds.delete(entity.netId);
      this.#entities.delete(id);
    }
    this.#toRemove.clear();

    for (const entity of this.#toAdd) {
      this.#entities.set(entity.id, entity);
    }
    this.#toAdd = [];
  }

  // нова хвиля астероїдів і бонуси
  spawnStuff(dt) {
    if (this.countKind('asteroid') === 0 && this.#toAdd.length === 0) {
      this.wave++;
      this.spawnWave(this.config.waveBase + this.wave);
    }

    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0) {
      this.pickupTimer = this.config.pickupEvery;
      if (this.countKind('pickup') < 2) {
        const effect = this.rng() < 0.5 ? 'shield' : 'triple';
        this.spawn(new Pickup({ pos: this.findSafeSpot(80), effect }));
      }
    }
  }

  spawnWave(count) {
    for (let i = 0; i < count; i++) {
      const pos = this.findSafeSpot(200);
      const vel = Vector2.fromAngle(this.rng() * Math.PI * 2, 30 + this.rng() * 50);
      const spin = (this.rng() - 0.5) * 2;
      const asteroid = new Asteroid({ pos, vel, size: 2, spin });

      // кожен hunterEvery-й - "мисливець", летить за найближчим кораблем (0 - без мисливців)
      const every = this.config.hunterEvery;
      if (every > 0 && i % every === every - 1) {
        asteroid.homing = makeHoming('ship', 0.8, 400);
      }
      this.spawn(asteroid);
    }
  }

  // випадкова точка, далеко від кораблів і астероїдів
  findSafeSpot(minDist) {
    let spot = new Vector2(this.arena.width / 2, this.arena.height / 2);
    for (let attempt = 0; attempt < 30; attempt++) {
      let ok = true;
      for (const entity of this) {
        if (!entity.solid) continue;
        if (entity.kind !== 'ship' && entity.kind !== 'asteroid') continue;
        if (spot.distanceTo(entity.pos) < minDist) {
          ok = false;
          break;
        }
      }
      if (ok) return spot;
      spot = new Vector2(this.rng() * this.arena.width, this.rng() * this.arena.height);
    }
    return spot;
  }
}
