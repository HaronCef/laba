import { Vector2 } from './vector.js';

// Базова сутність. Від неї наслідуються Ship, Bullet, Asteroid, Pickup, Explosion
// (лише один рівень extends).
export class Entity {
  static #nextId = 1; // спільний лічильник для всіх сутностей
  #id;

  constructor({ pos, vel = new Vector2(0, 0), angle = 0, radius = 10, kind = 'entity' }) {
    this.#id = Entity.#nextId++;
    this.pos = pos;
    this.vel = vel;
    this.angle = angle;
    this.radius = radius;
    this.kind = kind;
    this.alive = true; // false -> World прибере сутність в кінці кроку
    this.solid = true; // чи бере участь у зіткненнях

    // попередній стан для інтерполяції (як у лабі 1)
    this.prevPos = pos;
    this.prevAngle = angle;
  }

  get id() {
    return this.#id;
  }

  // Vector2 незмінний, тому копіювати не треба - достатньо зберегти посилання
  savePrevious() {
    this.prevPos = this.pos;
    this.prevAngle = this.angle;
  }

  update(dt) {
    this.pos = this.pos.add(this.vel.scale(dt));
  }
}
