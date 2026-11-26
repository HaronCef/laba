import { Entity } from './entity.ts';
import type { Vector2 } from './vector.ts';
import type { EntityId } from '../types.ts';
import type { World } from './world.ts';

export interface BulletOptions {
  pos: Vector2;
  vel: Vector2;
  ownerId: EntityId;
  shotId?: number;
  ttl?: number;
  damage?: number;
  radius?: number;
}

export class Bullet extends Entity {
  readonly kind = 'bullet';
  readonly ownerId: EntityId; // netId корабля, щоб куля не влучала у свій корабель
  readonly shotId: number; // за ним клієнт впізнає свою кулю (див. shotId() у ship.ts)
  readonly damage: number;
  ttl: number; // скільки секунд ще живе

  constructor({
    pos,
    vel,
    ownerId,
    shotId = 0,
    ttl = 1.2,
    damage = 1,
    radius = 3,
  }: BulletOptions) {
    super({ pos, vel, angle: vel.angle(), radius });
    this.ownerId = ownerId;
    this.shotId = shotId;
    this.ttl = ttl;
    this.damage = damage;
  }

  override update(dt: number, world: World): void {
    super.update(dt, world);
    if (this.homing) this.angle = this.vel.angle();
    this.ttl -= dt;
    if (this.ttl <= 0) {
      world.despawn(this.id);
    }
  }
}
