import { Vector2 } from './vector.js';
import { wrapPosition } from './arena.js';
import { Asteroid } from './asteroid.js';
import { Pickup } from './pickup.js';
import { makeHoming, homingSystem } from './components/homing.js';
import { findCollisions } from './collision.js';
import { handleCollision } from './rules.js';

const NO_INPUT = { left: false, right: false, thrust: false, flip: false };

export class World {
  #entities = new Map(); // id -> Entity
  #toRemove = new Set(); // id тих, кого прибрати в кінці кроку
  #toAdd = []; // створені під час кроку, додаються в кінці
  #stepping = false;

  constructor(arena) {
    this.arena = arena;
    this.score = 0;
    this.wave = 0;
    this.pickupTimer = 6;
  }

  get size() {
    return this.#entities.size;
  }

  get(id) {
    return this.#entities.get(id);
  }

  // Якщо додати в Map прямо під час for...of, цикл пройде і по новій сутності
  // в цьому ж кроці. Тому під час step нові сутності чекають до кінця кроку.
  spawn(entity) {
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

  step(dt, inputs) {
    this.#stepping = true;

    for (const entity of this) {
      entity.savePrevious();
    }

    // кожен корабель отримує своє керування (потім тут буде кілька гравців)
    for (const ship of this.ofKind('ship')) {
      ship.controls = inputs.get(ship.id) || NO_INPUT;
    }

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
      this.spawnWave(3 + this.wave);
    }

    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0) {
      this.pickupTimer = 8;
      if (this.countKind('pickup') < 2) {
        const effect = Math.random() < 0.5 ? 'shield' : 'triple';
        this.spawn(new Pickup({ pos: this.findSafeSpot(80), effect }));
      }
    }
  }

  spawnWave(count) {
    for (let i = 0; i < count; i++) {
      const pos = this.findSafeSpot(200);
      const vel = Vector2.fromAngle(Math.random() * Math.PI * 2, 30 + Math.random() * 50);
      const asteroid = new Asteroid({ pos, vel, size: 2 });

      // кожен третій - "мисливець", летить за кораблем
      if (i % 3 === 2) {
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
      spot = new Vector2(
        Math.random() * this.arena.width,
        Math.random() * this.arena.height,
      );
    }
    return spot;
  }
}
