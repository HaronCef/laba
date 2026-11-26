import { describe, expect, it } from 'vitest';
import { DrawablePool } from '../src/render/drawable.ts';
import { ParticlePool } from '../src/render/particles.ts';

describe('DrawablePool', () => {
  it('після reset ті самі об\'єкти перевикористовуються, нових не створюється', () => {
    const pool = new DrawablePool();
    const first = [pool.take('ship', 1, 2, 0), pool.take('bullet', 3, 4, 0)];
    pool.reset();
    const second = [pool.take('asteroid', 5, 6, 0), pool.take('bullet', 7, 8, 0)];
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(pool.size).toBe(2);
    expect(pool.list).toHaveLength(2);
  });

  it('take скидає прапорці минулого кадру (корабель не "успадковує" щит)', () => {
    const pool = new DrawablePool();
    const d = pool.take('ship', 0, 0, 0);
    d.shield = true;
    d.mine = true;
    pool.reset();
    const again = pool.take('bullet', 0, 0, 0);
    expect(again.shield).toBe(false);
    expect(again.mine).toBe(false);
    expect(again.kind).toBe('bullet');
  });
});

describe('ParticlePool', () => {
  it('вибух бере частинки з пулу, догорілі повертаються', () => {
    const pool = new ParticlePool(100);
    pool.explode(10, 10, 30, '#fff');
    expect(pool.active).toBe(30);
    pool.update(0.4);
    expect(pool.active).toBe(30); // ще горять (живуть 0.8 с)
    pool.update(0.5);
    expect(pool.active).toBe(0);
    expect(pool.items).toHaveLength(100); // нових об'єктів не створилось
  });

  it('пул повний - зайві частинки не створюються', () => {
    const pool = new ParticlePool(10);
    pool.explode(0, 0, 25, '#fff');
    expect(pool.active).toBe(10);
    expect(pool.items).toHaveLength(10);
  });

  it('частинки рухаються зі своєю швидкістю', () => {
    const pool = new ParticlePool(1);
    pool.explode(100, 100, 1, '#fff');
    const p = pool.items[0];
    if (!p) throw new Error('немає частинки');
    const { vx, vy } = p;
    pool.update(0.1);
    expect(p.x).toBeCloseTo(100 + vx * 0.1, 6);
    expect(p.y).toBeCloseTo(100 + vy * 0.1, 6);
  });
});
