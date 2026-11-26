import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBucket } from '../src/tokenBucket.ts';

describe('TokenBucket (rate limiter)', () => {
  it('повне відро: size повідомлень підряд, далі - відмова', () => {
    const bucket = new TokenBucket(3, 1, 0);
    expect([bucket.take(0), bucket.take(0), bucket.take(0), bucket.take(0)]).toEqual([true, true, true, false]);
  });

  it('жетони додаються з часом: refill за секунду', () => {
    const bucket = new TokenBucket(2, 4, 0);
    bucket.take(0);
    bucket.take(0);
    expect(bucket.take(100)).toBe(false); // 0.4 жетона
    expect(bucket.take(250)).toBe(true); // ще 0.6 -> рівно 1
  });

  it('більше size не накопичується, навіть після довгої паузи', () => {
    const bucket = new TokenBucket(5, 10, 0);
    bucket.take(60_000);
    expect(bucket.tokens).toBe(4);
  });

  it('30 input/с проходять через INPUT-відро (45, +35/с), а 60/с - ні', () => {
    const steady = new TokenBucket(45, 35, 0);
    let refused = 0;
    for (let i = 0; i < 300; i++) if (!steady.take((i * 1000) / 30)) refused++;
    expect(refused).toBe(0);

    const spam = new TokenBucket(45, 35, 0);
    refused = 0;
    for (let i = 0; i < 300; i++) if (!spam.take((i * 1000) / 60)) refused++;
    expect(refused).toBeGreaterThan(0);
  });
});

describe('TokenBucket з фейковим годинником', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('за замовчуванням бере Date.now(), тож його можна "перемотати"', () => {
    const bucket = new TokenBucket(1, 1);
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(bucket.take()).toBe(true);
  });
});
