import { Entity } from './entity.js';

export class Asteroid extends Entity {
  constructor({ pos, vel, size = 2 }) {
    const radius = size === 2 ? 30 : 15;
    super({ pos, vel, radius, kind: 'asteroid' });
    this.size = size;
    this.hp = size === 2 ? 3 : 1;
    this.spin = (Math.random() - 0.5) * 2; // рад/с, просто для краси

    // нерівна форма: множники радіуса для 10 вершин
    this.shape = [];
    for (let i = 0; i < 10; i++) {
      this.shape.push(0.75 + Math.random() * 0.35);
    }
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
