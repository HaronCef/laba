import { Entity } from './entity.js';
import { Vector2 } from './vector.js';

const LIFE = 0.8; // с

// Вибух - набір частинок, які розлітаються і зникають. Ні з чим не зіштовхується.
export class Explosion extends Entity {
  constructor({ pos, count = 16, color = '#ffb347' }) {
    super({ pos, radius: 0, kind: 'explosion' });
    this.solid = false;
    this.color = color;
    this.ttl = LIFE;
    this.particles = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 160;
      this.particles.push({ pos, vel: Vector2.fromAngle(angle, speed) });
    }
  }

  // скільки залишилось "життя" від 1 до 0 (для прозорості)
  get life() {
    return this.ttl / LIFE;
  }

  update(dt, world) {
    for (const p of this.particles) {
      p.pos = p.pos.add(p.vel.scale(dt));
    }
    this.ttl -= dt;
    if (this.ttl <= 0) {
      world.despawn(this.id);
    }
  }
}
