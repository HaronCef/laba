import { Vector2 } from './vector.ts';
import { wrapPosition, type Arena } from './arena.ts';
import { Asteroid } from './asteroid.ts';
import { Pickup } from './pickup.ts';
import { makeHoming, homingSystem } from './components/homing.ts';
import { findCollisions } from './collision.ts';
import { handleCollision } from './rules.ts';
import { mulberry32, type Rng } from '../rng.ts';
import { asEntityId, type EntityId } from '../types.ts';
import type { EntityKind, GameEvent } from '../protocol.ts';
import type { Bullet } from './bullet.ts';
import type { Ship } from './ship.ts';

// Будь-яка сутність світу. Це union, а не просто Entity: за полем kind
// TypeScript знає, які ще поля є (if (e.kind === 'ship') e.score ...).
export type AnyEntity = Ship | Bullet | Asteroid | Pickup;
export type EntityOfKind<K extends EntityKind> = Extract<AnyEntity, { kind: K }>;

export interface WorldConfig {
  readonly waveBase: number;
  readonly hunterEvery: number;
  readonly pickupEvery: number;
}

const DEFAULT_CONFIG: WorldConfig = { waveBase: 3, hunterEvery: 3, pickupEvery: 8 };

// type guard: якщо повертає true, TypeScript далі вважає e сутністю саме цього виду
function isKind<K extends EntityKind>(e: AnyEntity, kind: K): e is EntityOfKind<K> {
  return e.kind === kind;
}

// Світ гри. Його рахує лише сервер.
// Без DOM, без модулів Node, без Math.random() і Date.now():
// усі "випадкові" числа беруться з this.rng (mulberry32 з seed).
export class World {
  readonly #entities = new Map<number, AnyEntity>(); // id -> сутність
  readonly #toRemove = new Set<number>(); // id тих, кого прибрати в кінці кроку
  #toAdd: AnyEntity[] = []; // створені під час кроку, додаються в кінці
  #stepping = false;
  readonly #usedNetIds = new Set<number>();
  #nextNetId = 1;

  readonly arena: Arena;
  readonly config: WorldConfig;
  readonly seed: number;
  readonly rng: Rng;
  wave = 0;
  pickupTimer: number;
  events: GameEvent[] = [];

  constructor(arena: Arena, config: Partial<WorldConfig> = {}, seed = 1) {
    this.arena = arena;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.pickupTimer = this.config.pickupEvery;
  }

  emit(event: GameEvent): void {
    this.events.push(event);
  }

  // очки отримує корабель, чия куля влучила (null - нікому)
  addScore(shipNetId: EntityId | null, delta: number, pos: Vector2): void {
    if (shipNetId === null) return;
    const ship = this.byNetId(shipNetId);
    if (!ship || ship.kind !== 'ship') return;
    ship.score += delta;
    this.emit({
      type: 'score',
      ship: shipNetId,
      score: ship.score,
      delta,
      x: pos.x,
      y: pos.y,
    });
  }

  get size(): number {
    return this.#entities.size;
  }

  // Map.get може повернути undefined - тип це чесно показує
  get(id: number): AnyEntity | undefined {
    return this.#entities.get(id);
  }

  byNetId(netId: EntityId): AnyEntity | null {
    for (const entity of this.#entities.values()) {
      if (entity.netId === netId) return entity;
    }
    return null;
  }

  // netId - номер від 1 до 65535 для мережі (Uint16); зайняті пропускаємо
  #allocNetId(): EntityId {
    while (this.#usedNetIds.has(this.#nextNetId)) {
      this.#nextNetId = (this.#nextNetId % 65535) + 1;
    }
    const id = this.#nextNetId;
    this.#nextNetId = (this.#nextNetId % 65535) + 1;
    this.#usedNetIds.add(id);
    return asEntityId(id);
  }

  // Якщо додати в Map прямо під час for...of, цикл пройде і по новій сутності
  // в цьому ж кроці. Тому під час step нові сутності чекають до кінця кроку.
  // Дженерик: spawn(new Ship(...)) повертає саме Ship, а не просто AnyEntity.
  spawn<T extends AnyEntity>(entity: T): T {
    entity.netId = this.#allocNetId();
    if (this.#stepping) {
      this.#toAdd.push(entity);
    } else {
      this.#entities.set(entity.id, entity);
    }
    return entity;
  }

  // не видаляємо одразу, а лише позначаємо
  despawn(id: number): void {
    const entity = this.#entities.get(id);
    if (entity) {
      entity.alive = false;
      this.#toRemove.add(id);
    }
  }

  // видалити одразу (гравець вийшов між кроками)
  removeNow(id: number): void {
    const entity = this.#entities.get(id);
    if (!entity) return;
    this.#entities.delete(id);
    this.#usedNetIds.delete(entity.netId);
  }

  *[Symbol.iterator](): Generator<AnyEntity> {
    yield* this.#entities.values();
  }

  *ofKind<K extends EntityKind>(kind: K): Generator<EntityOfKind<K>> {
    for (const entity of this.#entities.values()) {
      if (isKind(entity, kind) && entity.alive) yield entity;
    }
  }

  countKind(kind: EntityKind): number {
    return [...this.ofKind(kind)].length;
  }

  // Один крок. Кораблі рухаються не тут, а в Ship.applyInput (по одному разу на input).
  step(dt: number): void {
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

  #sweep(): void {
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
  spawnStuff(dt: number): void {
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

  spawnWave(count: number): void {
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
  findSafeSpot(minDist: number): Vector2 {
    let spot = new Vector2(this.arena.width / 2, this.arena.height / 2);
    for (let attempt = 0; attempt < 30; attempt++) {
      let free = true;
      for (const entity of this) {
        if (!entity.solid) continue;
        if (entity.kind !== 'ship' && entity.kind !== 'asteroid') continue;
        if (spot.distanceTo(entity.pos) < minDist) {
          free = false;
          break;
        }
      }
      if (free) return spot;
      spot = new Vector2(this.rng() * this.arena.width, this.rng() * this.arena.height);
    }
    return spot;
  }
}
