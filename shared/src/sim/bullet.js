import { Entity } from './entity.js';

export class Bullet extends Entity {
  constructor({ pos, vel, ownerId, shotId = 0, ttl = 1.2, damage = 1, radius = 3 }) {
    super({ pos, vel, angle: vel.angle(), radius, kind: 'bullet' });
    this.ownerId = ownerId; // netId корабля, щоб куля не влучала у свій корабель
    this.shotId = shotId; // за ним клієнт впізнає свою кулю (див. shotId() у ship.js)
    this.ttl = ttl; // скільки секунд ще живе
    this.damage = damage;
  }

  update(dt, world) {
    super.update(dt);
    if (this.homing) this.angle = this.vel.angle();
    this.ttl -= dt;
    if (this.ttl <= 0) {
      world.despawn(this.id);
    }
  }
}
