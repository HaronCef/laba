import { Entity } from './entity.ts';
import type { Vector2 } from './vector.ts';
import type { World } from './world.ts';

export type AsteroidSize = 1 | 2;

export interface AsteroidOptions {
  pos: Vector2;
  vel: Vector2;
  size?: AsteroidSize;
  spin?: number; // передає World зі свого генератора (Math.random() у симуляції не можна)
}

export class Asteroid extends Entity {
  readonly kind = 'asteroid';
  readonly size: AsteroidSize;
  readonly spin: number; // рад/с, просто для краси
  hp: number;

  constructor({ pos, vel, size = 2, spin = 0 }: AsteroidOptions) {
    super({ pos, vel, radius: size === 2 ? 30 : 15 });
    this.size = size;
    this.hp = size === 2 ? 3 : 1;
    this.spin = spin;
  }

  override update(dt: number, world: World): void {
    super.update(dt, world);
    this.angle += this.spin * dt;
  }

  // повертає true, якщо астероїд зруйновано
  takeDamage(amount: number): boolean {
    this.hp -= amount;
    return this.hp <= 0;
  }
}
