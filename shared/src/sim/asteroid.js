import { Entity } from './entity.js';

export class Asteroid extends Entity {
  // spin передає World зі свого генератора (Math.random() у симуляції не можна)
  constructor({ pos, vel, size = 2, spin = 0 }) {
    const radius = size === 2 ? 30 : 15;
    super({ pos, vel, radius, kind: 'asteroid' });
    this.size = size;
    this.hp = size === 2 ? 3 : 1;
    this.spin = spin; // рад/с, просто для краси
  }

  update(dt) {
    super.update(dt);
    this.angle += this.spin * dt;
  }

  // повертає true, якщо астероїд зруйновано
  takeDamage(amount) {
    this.hp -= amount;
    return this.hp <= 0;
  }
}
