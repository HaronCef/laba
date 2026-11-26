import { Vector2 } from './vector.js';

// Базова сутність. Від неї наслідуються Ship, Bullet, Asteroid, Pickup (лише один рівень extends).
export class Entity {
  static #nextId = 1; // спільний лічильник для всіх сутностей
  #id;

  constructor({ pos, vel = new Vector2(0, 0), angle = 0, radius = 10, kind = 'entity' }) {
    this.#id = Entity.#nextId++;
    this.netId = 0; // короткий номер для мережі (Uint16), його дає World.spawn
    this.pos = pos;
    this.vel = vel;
    this.angle = angle;
    this.radius = radius;
    this.kind = kind;
    this.alive = true; // false -> World прибере сутність в кінці кроку
    this.solid = true; // чи бере участь у зіткненнях
  }

  get id() {
    return this.#id;
  }

  update(dt) {
    this.pos = this.pos.add(this.vel.scale(dt));
  }
}
