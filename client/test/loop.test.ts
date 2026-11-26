import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoop, type Scheduler } from '../src/loop.ts';

// Замість requestAnimationFrame - setTimeout(16) і фейковий годинник
function timerScheduler(frameMs: number): Scheduler {
  return {
    now: () => Date.now(),
    request: (cb) => Number(setTimeout(() => cb(Date.now()), frameMs)),
    cancel: (id) => clearTimeout(id),
  };
}

describe('цикл з акумулятором (фейкові таймери)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('60 кроків за секунду при кадрах по 16 мс', () => {
    let steps = 0;
    const loop = createLoop({ step: 1 / 60, simulate: () => steps++, render: () => {}, scheduler: timerScheduler(16) });
    loop.start();
    vi.advanceTimersByTime(1008); // 63 кадри
    loop.stop();
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(61);
  });

  it('кількість кроків не залежить від частоти кадрів (30 і 144 Гц)', () => {
    const count = (frameMs: number): number => {
      let steps = 0;
      const loop = createLoop({ step: 1 / 60, simulate: () => steps++, render: () => {}, scheduler: timerScheduler(frameMs) });
      loop.start();
      vi.advanceTimersByTime(2000);
      loop.stop();
      return steps;
    };
    expect(Math.abs(count(33) - count(7))).toBeLessThanOrEqual(2);
  });

  it('довга пауза (вкладка у фоні) обрізається до 0.25 с, а не 1000 кроків пачкою', () => {
    let steps = 0;
    const loop = createLoop({ step: 1 / 60, simulate: () => steps++, render: () => {}, scheduler: timerScheduler(5000) });
    loop.start();
    vi.advanceTimersByTime(5000);
    loop.stop();
    expect(steps).toBe(15); // 0.25 / (1/60)
  });

  it('alpha у render - від 0 до 1', () => {
    const alphas: number[] = [];
    const loop = createLoop({ step: 1 / 60, simulate: () => {}, render: (a) => alphas.push(a), scheduler: timerScheduler(10) });
    loop.start();
    vi.advanceTimersByTime(500);
    loop.stop();
    expect(alphas.length).toBeGreaterThan(40);
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('stop() - більше жодного кадру', () => {
    let frames = 0;
    const loop = createLoop({ simulate: () => {}, render: () => frames++, scheduler: timerScheduler(16) });
    loop.start();
    vi.advanceTimersByTime(160);
    loop.stop();
    const before = frames;
    vi.advanceTimersByTime(1000);
    expect(frames).toBe(before);
  });
});
