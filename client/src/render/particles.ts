// Пул частинок для вибухів. Створюємо всі один раз, потім лише перевикористовуємо.
// Перші active штук - живі, решта - вільні.

export class Particle {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  life = 0; // від 1 до 0
  color = '#ffb347';
}

export class ParticlePool {
  readonly items: Particle[] = [];
  active = 0;

  constructor(size: number) {
    for (let i = 0; i < size; i++) this.items.push(new Particle());
  }

  explode(x: number, y: number, count: number, color: string): void {
    for (let i = 0; i < count && this.active < this.items.length; i++) {
      const p = this.items[this.active];
      if (!p) return;
      this.active++;
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 160;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 1;
      p.color = color;
    }
    // якщо пул закінчився - зайві частинки просто не малюємо
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.active) {
      const p = this.items[i];
      if (!p) break;
      p.life -= dt / 0.8;
      if (p.life <= 0) {
        // догоріла - міняємо місцями з останньою живою
        const last = this.items[this.active - 1];
        if (last) {
          this.items[i] = last;
          this.items[this.active - 1] = p;
        }
        this.active--;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      i++;
    }
  }
}
