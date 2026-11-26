import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world.ts';
import { Ship, setBreakDeterminism } from '../src/sim/ship.ts';
import { Asteroid } from '../src/sim/asteroid.ts';
import { Bullet } from '../src/sim/bullet.ts';
import { Vector2 } from '../src/sim/vector.ts';
import { ARENA, wrapPosition, wrapValue } from '../src/sim/arena.ts';
import { DT } from '../src/sim/constants.ts';
import { entityToRecord } from '../src/snapshot.ts';
import { scriptedInput } from '../src/scripted.ts';
import { hashNumbers } from '../src/hash.ts';
import { mulberry32 } from '../src/rng.ts';
import { asEntityId } from '../src/types.ts';

// "Клон" світу = той самий seed і ті самі дії (сам World не скопіювати, rng - замикання).
function makeWorld(seed: number): { world: World; a: Ship; b: Ship } {
  const world = new World(ARENA, { waveBase: 4 }, seed);
  const a = world.spawn(new Ship(new Vector2(300, 300), 'A'));
  const b = world.spawn(new Ship(new Vector2(900, 400), 'B'));
  return { world, a, b };
}

function run(w: ReturnType<typeof makeWorld>, steps: number): void {
  for (let i = 0; i < steps; i++) {
    w.a.applyInput(scriptedInput(i), w.world);
    w.b.applyInput(scriptedInput(i + 50), w.world);
    w.world.step(DT);
  }
}

const state = (world: World): unknown => [...world].map(entityToRecord);

describe('World.step', () => {
  it('симуляція імпортується в Node без DOM', () => {
    expect('document' in globalThis).toBe(false);
  });

  it('детермінізм: два однакові світи після 600 кроків глибоко рівні', () => {
    const one = makeWorld(42);
    const two = makeWorld(42);
    run(one, 600);
    run(two, 600);
    expect(state(two.world)).toStrictEqual(state(one.world));
    expect(two.world.wave).toBe(one.world.wave);
    expect(state(one.world)).not.toStrictEqual(state(makeWorld(43).world));
  });

  it('детермінізм ламається, якщо в integrate є Math.random (перевірка, що тест щось ловить)', () => {
    setBreakDeterminism(true);
    try {
      const one = makeWorld(42);
      const two = makeWorld(42);
      run(one, 30);
      run(two, 30);
      expect(state(two.world)).not.toStrictEqual(state(one.world));
    } finally {
      setBreakDeterminism(false);
    }
  });

  it('куля руйнує маленький астероїд і дає очки власнику', () => {
    const world = new World(ARENA, { waveBase: 0, pickupEvery: 1000 }, 1);
    world.wave = -1; // нова хвиля буде з 0 астероїдів (waveBase + wave)
    const ship = world.spawn(new Ship(new Vector2(100, 600), 'A'));
    const target = world.spawn(new Asteroid({ pos: new Vector2(500, 300), vel: new Vector2(0, 0), size: 1 }));
    world.spawn(new Bullet({ pos: new Vector2(495, 300), vel: new Vector2(0, 0), ownerId: ship.netId }));
    world.step(DT);
    expect(target.alive).toBe(false);
    expect(world.get(target.id)).toBeUndefined();
    expect(ship.score).toBe(100);
    expect(world.events.map((e) => e.type)).toEqual(['hit', 'exploded', 'score']);
  });

  it('великий астероїд розпадається на два маленьких', () => {
    const world = new World(ARENA, { waveBase: 0, pickupEvery: 1000 }, 1);
    world.spawn(new Asteroid({ pos: new Vector2(500, 300), vel: new Vector2(0, 0), size: 2 }));
    const ship = world.spawn(new Ship(new Vector2(500, 300), 'A')); // таран
    world.step(DT);
    expect([...world.ofKind('asteroid')].map((a) => a.size)).toEqual([1, 1]);
    expect(ship.hp).toBe(60);
  });

  it('netId: від 1, без повторів, звільняється після removeNow', () => {
    const world = new World(ARENA, {}, 1);
    const a = world.spawn(new Ship(new Vector2(0, 0)));
    const b = world.spawn(new Ship(new Vector2(0, 0)));
    expect([a.netId, b.netId]).toEqual([asEntityId(1), asEntityId(2)]);
    world.removeNow(a.id);
    expect(world.byNetId(a.netId)).toBeNull();
    expect(world.size).toBe(1);
  });

  it('spawn під час кроку додає сутність лише в кінці кроку', () => {
    const world = new World(ARENA, { waveBase: 2 }, 7);
    expect(world.size).toBe(0);
    world.step(DT); // хвиля 1 = waveBase + 1 = 3 астероїди, з'являються в кінці кроку
    expect(world.countKind('asteroid')).toBe(3);
  });
});

describe('дрібниці shared', () => {
  it('wrapValue / wrapPosition загортають координати', () => {
    expect(wrapValue(-1, 100)).toBe(99);
    expect(wrapValue(250, 100)).toBe(50);
    expect(wrapPosition(new Vector2(1281, -1), ARENA)).toEqual(new Vector2(1, 719));
  });

  it('mulberry32: той самий seed - ті самі числа в [0, 1)', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('hashNumbers: стабільний і чутливий до змін', () => {
    expect(hashNumbers([1, 2, 3])).toBe(hashNumbers([1, 2, 3]));
    expect(hashNumbers([1, 2, 3])).not.toBe(hashNumbers([1, 2, 3.0001]));
  });
});
