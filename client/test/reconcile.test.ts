import { describe, expect, it } from 'vitest';
import { reconcile, wrappedDelta, SNAP_DISTANCE } from '../src/net/reconcile.ts';
import { stepShip, type ShipState } from 'shared/sim/ship.ts';
import { asSeq } from 'shared/types.ts';
import type { Input } from 'shared/protocol.ts';

const input = (seq: number, turn: -1 | 0 | 1 = 0): Input => ({ seq: asSeq(seq), turn, thrust: true, fire: false, missile: false, flip: false });
const start: ShipState = { x: 200, y: 200, vx: 0, vy: 0, angle: 0, shotCd: 0, missileCd: 0, triple: false };

// "клієнт": прогнозує всі input від стану start
function predict(from: ShipState, inputs: readonly Input[]): ShipState {
  let s = from;
  for (const i of inputs) s = stepShip(s, i).state;
  return s;
}

describe('reconcile (чиста функція)', () => {
  it('сервер погоджується з прогнозом - поправка 0, підтверджені input викинуто', () => {
    const inputs = [input(1), input(2), input(3), input(4), input(5)];
    const predicted = predict(start, inputs);
    const server = predict(start, inputs.slice(0, 3)); // сервер обробив 1..3
    const r = reconcile(server, asSeq(3), inputs, predicted);
    expect(r.pending.map((i) => i.seq)).toEqual([4, 5]);
    expect(r.correction).toBeCloseTo(0, 9);
    expect(r.snap).toBe(false);
    expect(r.state).toEqual(predicted);
  });

  it('сервер відхилився (зіткнення) - поправка = різниця, стан = сервер + непідтверджені', () => {
    const inputs = [input(1), input(2), input(3)];
    const predicted = predict(start, inputs);
    const server = { ...predict(start, inputs.slice(0, 1)), x: predict(start, inputs.slice(0, 1)).x + 10 };
    const r = reconcile(server, asSeq(1), inputs, predicted);
    expect(r.dx).toBeCloseTo(10, 6);
    expect(r.correction).toBeCloseTo(10, 6);
    expect(r.state).toEqual(predict(server, inputs.slice(1)));
  });

  it('велика поправка (респаун) - snap без згладжування', () => {
    const r = reconcile({ ...start, x: 900 }, asSeq(0), [], start);
    expect(r.correction).toBeGreaterThan(SNAP_DISTANCE);
    expect(r.snap).toBe(true);
  });

  it('поправка через край арени - коротким шляхом (wrappedDelta)', () => {
    expect(wrappedDelta(1270, 1280)).toBe(-10);
    expect(wrappedDelta(-1270, 1280)).toBe(10);
    const r = reconcile({ ...start, x: 2 }, asSeq(0), [], { ...start, x: 1278 });
    expect(r.dx).toBeCloseTo(4, 6);
    expect(r.snap).toBe(false);
  });

  it('не змінює вхідний масив pending', () => {
    const inputs = [input(1), input(2)];
    reconcile(start, asSeq(1), inputs, start);
    expect(inputs).toHaveLength(2);
  });
});
