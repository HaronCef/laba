import { afterEach, describe, expect, it } from 'vitest';
import {
  BULLET_SPEED,
  MISSILE_COOLDOWN_STEPS,
  SHIP_SETTINGS,
  SHOT_COOLDOWN_STEPS,
  Ship,
  integrate,
  setBreakDeterminism,
  shotId,
  stepShip,
  type ShipState,
} from '../src/sim/ship.ts';
import { World } from '../src/sim/world.ts';
import { Vector2 } from '../src/sim/vector.ts';
import { ARENA } from '../src/sim/arena.ts';
import { DT } from '../src/sim/constants.ts';
import { runScriptedShip } from '../src/scripted.ts';
import { asSeq } from '../src/types.ts';

const idle = { turn: 0, thrust: false, flip: false, fire: false, missile: false } as const;
const start: ShipState = { x: 100, y: 100, vx: 0, vy: 0, angle: 0, shotCd: 0, missileCd: 0, triple: false };

describe('integrate (відомі входи -> відомий результат)', () => {
  afterEach(() => setBreakDeterminism(false));

  it('без input корабель стоїть на місці', () => {
    expect(integrate(start, idle, DT)).toEqual({ x: 100, y: 100, vx: 0, vy: 0, angle: 0 });
  });

  it('тяга носом вправо: v = thrust*dt*e^(-drag*dt), x += v*dt', () => {
    const r = integrate(start, { ...idle, thrust: true }, DT);
    const v = SHIP_SETTINGS.thrustPower * DT * Math.exp(-SHIP_SETTINGS.drag * DT);
    expect(r.vx).toBeCloseTo(v, 10);
    expect(r.vy).toBeCloseTo(0, 10);
    expect(r.x).toBeCloseTo(100 + v * DT, 10);
  });

  it('поворот: turn * turnSpeed * dt, flip додає PI', () => {
    expect(integrate(start, { ...idle, turn: 1 }, DT).angle).toBeCloseTo(SHIP_SETTINGS.turnSpeed * DT, 10);
    expect(integrate(start, { ...idle, turn: -1 }, DT).angle).toBeCloseTo(-SHIP_SETTINGS.turnSpeed * DT, 10);
    expect(integrate({ ...start, angle: 0.5 }, { ...idle, flip: true }, DT).angle).toBeCloseTo(0.5 - Math.PI, 10);
  });

  it('швидкість не більша за maxSpeed', () => {
    const r = integrate({ ...start, vx: 10_000 }, { ...idle, thrust: true }, DT);
    expect(Math.hypot(r.vx, r.vy)).toBeCloseTo(SHIP_SETTINGS.maxSpeed, 6);
  });

  it('setBreakDeterminism(true) робить результат випадковим (лаба 5)', () => {
    setBreakDeterminism(true);
    const a = integrate(start, idle, DT);
    const b = integrate(start, idle, DT);
    expect(a.vx).not.toBe(b.vx);
  });
});

describe('stepShip', () => {
  it('постріл: куля з носа зі швидкістю BULLET_SPEED, потім кулдаун', () => {
    const first = stepShip(start, { ...idle, fire: true });
    expect(first.shots).toHaveLength(1);
    const shot = first.shots[0];
    expect(shot?.vx).toBeCloseTo(BULLET_SPEED, 6);
    expect(shot?.x).toBeCloseTo(118, 6); // NOSE = 18 px
    expect(first.state.shotCd).toBe(SHOT_COOLDOWN_STEPS);
    // наступні 4 кроки - без пострілу, на 5-й знову можна
    let s = first.state;
    for (let i = 0; i < SHOT_COOLDOWN_STEPS - 1; i++) {
      const r = stepShip(s, { ...idle, fire: true });
      expect(r.shots).toHaveLength(0);
      s = r.state;
    }
    expect(stepShip(s, { ...idle, fire: true }).shots).toHaveLength(1);
  });

  it('потрійний постріл і ракета (index 3)', () => {
    const r = stepShip({ ...start, triple: true }, { ...idle, fire: true, missile: true });
    expect(r.shots.map((s) => s.index)).toEqual([0, 1, 2, 3]);
    expect(r.shots[3]?.missile).toBe(true);
    expect(r.state.missileCd).toBe(MISSILE_COOLDOWN_STEPS);
  });

  it('загортання через край арени', () => {
    const r = stepShip({ ...start, x: ARENA.width - 1, vx: 300 }, idle);
    expect(r.state.x).toBeGreaterThanOrEqual(0);
    expect(r.state.x).toBeLessThan(10);
  });

  it('shotId: seq*4 + index, у межах Uint16', () => {
    expect(shotId(asSeq(10), 2)).toBe(42);
    expect(shotId(asSeq(0x10000), 1)).toBe(1);
  });
});

describe('Ship', () => {
  it('1000 скриптових кроків дають той самий хеш, що й у лабах 5-6', () => {
    expect(runScriptedShip()).toBe('62305ba3');
  });

  it('урон, смерть і щит', () => {
    const world = new World(ARENA, {}, 1);
    const ship = world.spawn(new Ship(new Vector2(100, 100), 'A'));
    expect(ship.takeDamage(40)).toBe(false);
    expect(ship.hp).toBe(60);
    ship.applyPickup({ effect: 'shield', duration: 5 });
    expect(ship.takeDamage(100)).toBe(false); // під щитом
    ship.effects.shield = 0;
    expect(ship.takeDamage(100)).toBe(true);
    expect(ship.isDead).toBe(true);
    expect(ship.solid).toBe(false);
  });

  it('applyInput рухає корабель так само, як stepShip (сервер = прогноз клієнта)', () => {
    const world = new World(ARENA, {}, 1);
    const ship = world.spawn(new Ship(new Vector2(200, 200), 'A'));
    const input = { seq: asSeq(1), turn: 1, thrust: true, fire: false, missile: false, flip: false } as const;
    const expected = stepShip(ship.toState(), input).state;
    ship.applyInput(input, world);
    expect(ship.pos.x).toBeCloseTo(expected.x, 10);
    expect(ship.pos.y).toBeCloseTo(expected.y, 10);
    expect(ship.angle).toBeCloseTo(expected.angle, 10);
  });
});
