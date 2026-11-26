import { Vector2 } from './vector.ts';
import { asEntityId, type EntityId } from '../types.ts';
import type { EntityKind } from '../protocol.ts';
import type { Homing } from './components/homing.ts';
import type { World } from './world.ts';

export interface EntityOptions {
  pos: Vector2;
  vel?: Vector2;
  angle?: number;
  radius?: number;
}

// Базова сутність. Від неї наслідуються Ship, Bullet, Asteroid, Pickup (лише один рівень extends).
// Поле kind кожен клас задає сам ('ship', 'bullet', ...), і саме за ним TypeScript
// розрізняє сутності в union AnyEntity (див. world.ts).
export abstract class Entity {
  static #nextId = 1; // спільний лічильник для всіх сутностей
  readonly #id: number;

  abstract readonly kind: EntityKind;
  netId: EntityId = asEntityId(0); // короткий номер для мережі (Uint16), його дає World.spawn
  pos: Vector2;
  vel: Vector2;
  angle: number;
  radius: number;
  alive = true; // false -> World прибере сутність в кінці кроку
  solid = true; // чи бере участь у зіткненнях
  // компонент самонаведення: його можна дати будь-якій сутності (у JS це поле з'являлось
  // "з нізвідки" - TypeScript змусив оголосити його тут)
  homing: Homing | null = null;

  constructor({ pos, vel = new Vector2(0, 0), angle = 0, radius = 10 }: EntityOptions) {
    this.#id = Entity.#nextId++;
    this.pos = pos;
    this.vel = vel;
    this.angle = angle;
    this.radius = radius;
  }

  get id(): number {
    return this.#id;
  }

  update(dt: number, _world: World): void {
    this.pos = this.pos.add(this.vel.scale(dt));
  }
}
