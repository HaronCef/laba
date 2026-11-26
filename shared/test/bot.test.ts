import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { Bot, turnTo, type PlayerInput } from '../src/sim/bot.ts';
import { World } from '../src/sim/world.ts';
import { Ship, stepShip, type ShipState } from '../src/sim/ship.ts';
import { Asteroid } from '../src/sim/asteroid.ts';
import { Vector2 } from '../src/sim/vector.ts';
import { ARENA } from '../src/sim/arena.ts';
import { DT } from '../src/sim/constants.ts';
import { asSeq } from '../src/types.ts';
import type { Input } from '../src/protocol.ts';

function emptyWorld(): World {
  const world = new World(ARENA, { waveBase: 0, pickupEvery: 1e9 }, 1);
  world.wave = -1;
  return world;
}

describe('Bot', () => {
  it('turnTo: крутить у бік цілі, по носу - не крутить', () => {
    expect(turnTo(0, 1)).toBe(1);
    expect(turnTo(0, -1)).toBe(-1);
    expect(turnTo(0, 0.01)).toBe(0);
    expect(turnTo(3, -3)).toBe(1); // коротший шлях через PI
  });

  it('chase: летить до далекої цілі, а коли ціль по носу - стріляє', () => {
    const world = emptyWorld();
    const ship = world.spawn(new Ship(new Vector2(100, 360), 'bot'));
    ship.angle = 0;
    world.spawn(new Ship(new Vector2(500, 360), 'enemy'));
    const bot = new Bot(1);
    const input = bot.think(world, ship);
    expect(bot.mode).toBe('chase');
    expect(input.thrust).toBe(true);
    expect(input.fire).toBe(true);
  });

  it('evade: астероїд поруч - ніс від нього і газ, без стрільби', () => {
    const world = emptyWorld();
    const ship = world.spawn(new Ship(new Vector2(300, 300), 'bot'));
    ship.angle = 0; // дивиться на астероїд
    world.spawn(new Asteroid({ pos: new Vector2(380, 300), vel: new Vector2(0, 0), size: 2 }));
    const bot = new Bot(1);
    const input = bot.think(world, ship);
    expect(bot.mode).toBe('evade');
    expect(input.thrust).toBe(true);
    expect(input.fire).toBe(false);
    expect(input.turn).not.toBe(0);
  });

  it('бот - це PlayerInput: дає звичайний Input з seq по порядку, як людина', () => {
    const world = emptyWorld();
    const ship = world.spawn(new Ship(new Vector2(300, 300), 'bot'));
    const source: PlayerInput = new Bot(3);
    const seqs = [0, 1, 2].map(() => {
      const list = source.take(world, ship);
      expect(list).toHaveLength(1);
      const input = list[0];
      if (!input) throw new Error('немає input');
      ship.applyInput(input, world); // той самий шлях, що й для input людини
      return input.seq;
    });
    expect(seqs).toEqual([asSeq(1), asSeq(2), asSeq(3)]);
  });

  it('мертвий корабель бота нічого не робить', () => {
    const world = emptyWorld();
    const ship = world.spawn(new Ship(new Vector2(300, 300), 'bot'));
    ship.takeDamage(1000);
    const input = new Bot(1).think(world, ship);
    expect([input.turn, input.thrust, input.fire]).toEqual([0, false, false]);
  });

  it('8 ботів 600 кроків у світі з астероїдами - без винятків і всі в арені', () => {
    const world = new World(ARENA, { waveBase: 4 }, 5);
    const bots = Array.from({ length: 8 }, (_, i) => ({ ship: world.spawn(new Ship(world.findSafeSpot(100), `b${i}`)), bot: new Bot(i + 1) }));
    for (let step = 0; step < 600; step++) {
      for (const { ship, bot } of bots) for (const input of bot.take(world, ship)) ship.applyInput(input, world);
      world.step(DT);
    }
    for (const { ship } of bots) {
      expect(ship.pos.x).toBeGreaterThanOrEqual(0);
      expect(ship.pos.x).toBeLessThan(ARENA.width);
    }
  });
});

describe('властивість: кораблі не виходять за арену', () => {
  const inputArb = fc.record({
    turn: fc.constantFrom(-1 as const, 0 as const, 1 as const),
    thrust: fc.boolean(),
    fire: fc.boolean(),
    missile: fc.boolean(),
    flip: fc.boolean(),
  });

  it('1000 випадкових input підряд: 0 <= x < 1280, 0 <= y < 720 на кожному кроці', async () => {
    await fc.assert(
      fc.property(
        fc.double({ min: 0, max: ARENA.width - 0.001, noNaN: true }),
        fc.double({ min: 0, max: ARENA.height - 0.001, noNaN: true }),
        fc.array(inputArb, { minLength: 1000, maxLength: 1000 }),
        (x, y, inputs) => {
          let s: ShipState = { x, y, vx: 0, vy: 0, angle: 0, shotCd: 0, missileCd: 0, triple: false };
          for (const [i, input] of inputs.entries()) {
            const full: Input = { seq: asSeq(i + 1), ...input };
            s = stepShip(s, full).state;
            if (!(s.x >= 0 && s.x < ARENA.width && s.y >= 0 && s.y < ARENA.height)) {
              throw new Error(`вилетів на кроці ${i}: ${s.x}, ${s.y}`);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
