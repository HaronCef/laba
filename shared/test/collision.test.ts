import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { findCollisions, findPairsHashed, findPairsNaive, overlaps } from '../src/sim/collision.ts';
import { Asteroid } from '../src/sim/asteroid.ts';
import { Bullet } from '../src/sim/bullet.ts';
import { Ship } from '../src/sim/ship.ts';
import { World } from '../src/sim/world.ts';
import { Vector2 } from '../src/sim/vector.ts';
import { ARENA } from '../src/sim/arena.ts';
import { DT } from '../src/sim/constants.ts';
import { asEntityId } from '../src/types.ts';

const rock = (x: number, y: number, size: 1 | 2 = 2): Asteroid => new Asteroid({ pos: new Vector2(x, y), vel: new Vector2(0, 0), size });
const ids = (pairs: ReturnType<typeof findPairsNaive>): number[][] => pairs.map(([a, b]) => [a.id, b.id]);

describe('зіткнення коло-коло', () => {
  it('перекриття - зіткнення', () => {
    expect(overlaps(rock(100, 100), rock(150, 100))).toBe(true); // 50 < 30 + 30
  });

  it('дотик (відстань рівно r1 + r2) - ще не зіткнення', () => {
    expect(overlaps(rock(100, 100), rock(160, 100))).toBe(false); // 60 == 30 + 30
    expect(overlaps(rock(100, 100), rock(159.999, 100))).toBe(true);
  });

  it('далеко - промах', () => {
    expect(findPairsNaive([rock(100, 100), rock(400, 400)])).toEqual([]);
  });

  it('findCollisions бере лише живі і solid', () => {
    const world = new World(ARENA, {}, 1);
    const a = world.spawn(rock(100, 100));
    world.spawn(rock(120, 100));
    expect(findCollisions(world)).toHaveLength(1);
    a.solid = false;
    expect(findCollisions(world)).toHaveLength(0);
  });

  it('швидка куля (520 px/с) не "проскакує" маленький астероїд: крок 17 px < діаметр 36 px', () => {
    const target = rock(300, 100, 1); // радіус 15, куля 3
    let hit = false;
    for (let step = 0; step < 60 && !hit; step++) {
      const x = 200 + 520 * DT * step;
      hit = overlaps(new Bullet({ pos: new Vector2(x, 100), vel: new Vector2(520, 0), ownerId: asEntityId(1) }), target);
    }
    expect(hit).toBe(true);
  });

  it('tunneling є, якщо куля за крок пролітає більше за діаметр (обмеження дискретної перевірки)', () => {
    const target = rock(300, 100, 1);
    const fast = 3000; // 100 px за крок
    const hits = [0, 1, 2, 3].map((step) =>
      overlaps(new Bullet({ pos: new Vector2(240 + fast * DT * step, 100), vel: new Vector2(fast, 0), ownerId: asEntityId(1) }), target),
    );
    expect(hits).toEqual([false, false, false, false]); // 240 -> 340: астероїд на 300 пропущено
  });
});

describe('spatial hash (лаба 7)', () => {
  it('знаходить пару на межі клітинок', () => {
    const list = [rock(63, 100, 1), rock(66, 100, 1)]; // різні клітинки по 64 px
    expect(ids(findPairsHashed(list))).toEqual(ids(findPairsNaive(list)));
    expect(findPairsHashed(list)).toHaveLength(1);
  });

  it('властивість: ті самі пари і в тому ж порядку, що й O(n^2)', async () => {
    const entity = fc.record({
      x: fc.double({ min: -50, max: 1330, noNaN: true }),
      y: fc.double({ min: -50, max: 770, noNaN: true }),
      kind: fc.constantFrom('big', 'small', 'ship', 'bullet'),
    });
    await fc.assert(
      fc.property(fc.array(entity, { maxLength: 80 }), (specs) => {
        const list = specs.map(({ x, y, kind }) => {
          const pos = new Vector2(x, y);
          if (kind === 'ship') return new Ship(pos, 's');
          if (kind === 'bullet') return new Bullet({ pos, vel: new Vector2(1, 0), ownerId: asEntityId(1) });
          return rock(x, y, kind === 'big' ? 2 : 1);
        });
        expect(ids(findPairsHashed(list))).toEqual(ids(findPairsNaive(list)));
      }),
      { numRuns: 200 },
    );
  });
});
