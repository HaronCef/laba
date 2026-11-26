import { Entity } from './entity.js';

export class Bullet extends Entity {
  constructor({ pos, vel, ownerId, ttl = 1.2, damage = 1, radius = 3 }) {
    super({ pos, vel, angle: vel.angle(), radius, kind: 'bullet' });
    this.ownerId = ownerId; // щоб куля не влучала у свій корабель
    this.ttl = ttl; // скільки секунд ще живе
    this.damage = damage;
  }

  update(dt, world) {
    super.update(dt);
    this.ttl -= dt;
    if (this.ttl <= 0) {
      world.despawn(this.id);
    }
  }
}
