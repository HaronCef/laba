import { describe, expect, it } from 'vitest';
import { Vector2, normalizeAngle } from '../src/sim/vector.ts';

describe('Vector2', () => {
  it('add / sub / scale повертають новий вектор', () => {
    const a = new Vector2(1, 2);
    const b = new Vector2(3, -4);
    expect(a.add(b)).toEqual(new Vector2(4, -2));
    expect(a.sub(b)).toEqual(new Vector2(-2, 6));
    expect(a.scale(3)).toEqual(new Vector2(3, 6));
    expect(a).toEqual(new Vector2(1, 2)); // старий не змінився
  });

  it('length і distanceTo (трикутник 3-4-5)', () => {
    expect(new Vector2(3, 4).length()).toBe(5);
    expect(new Vector2(1, 1).distanceTo(new Vector2(4, 5))).toBe(5);
  });

  it('normalize: довжина 1, а нульовий вектор лишається нульовим (без NaN)', () => {
    expect(new Vector2(10, 0).normalize()).toEqual(new Vector2(1, 0));
    expect(new Vector2(3, 4).normalize().length()).toBeCloseTo(1, 10);
    expect(new Vector2(0, 0).normalize()).toEqual(new Vector2(0, 0));
  });

  it('fromAngle, angle і rotate', () => {
    const v = Vector2.fromAngle(Math.PI / 2, 2);
    expect(v.x).toBeCloseTo(0, 10);
    expect(v.y).toBeCloseTo(2, 10);
    expect(v.angle()).toBeCloseTo(Math.PI / 2, 10);
    const r = new Vector2(1, 0).rotate(Math.PI);
    expect(r.x).toBeCloseTo(-1, 10);
    expect(r.y).toBeCloseTo(0, 10);
  });

  it('dot: перпендикулярні дають 0', () => {
    expect(new Vector2(1, 0).dot(new Vector2(0, 5))).toBe(0);
    expect(new Vector2(2, 3).dot(new Vector2(4, 5))).toBe(23);
  });
});

describe('normalizeAngle', () => {
  it.each([
    [0, 0],
    [Math.PI / 2, Math.PI / 2],
    [Math.PI, -Math.PI], // межа: PI переходить у -PI
    [3 * Math.PI, -Math.PI],
    [-Math.PI / 2 - 2 * Math.PI, -Math.PI / 2],
  ])('normalizeAngle(%s)', (input, expected) => {
    expect(normalizeAngle(input)).toBeCloseTo(expected, 10);
  });
});
