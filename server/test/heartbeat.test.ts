import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHeartbeat, type HeartbeatClient } from '../src/heartbeat.ts';

function client(): HeartbeatClient & { pings: number; dead: boolean } {
  const c = {
    missedPongs: 0,
    pings: 0,
    dead: false,
    socket: {
      ping: () => {
        c.pings++;
      },
      terminate: () => {
        c.dead = true;
      },
    },
  };
  return c;
}

describe('heartbeat (фейкові таймери)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ping раз на інтервал', () => {
    const c = client();
    const stop = startHeartbeat(() => [c], { intervalMs: 15_000, maxMissed: 2 });
    vi.advanceTimersByTime(14_999);
    expect(c.pings).toBe(0);
    vi.advanceTimersByTime(1);
    expect(c.pings).toBe(1);
    stop();
  });

  it('клієнт, що відповідає (pong скидає лічильник), живе', () => {
    const c = client();
    const stop = startHeartbeat(() => [c], { intervalMs: 1000, maxMissed: 2 });
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      c.missedPongs = 0; // прийшов pong
    }
    expect(c.dead).toBe(false);
    expect(c.pings).toBe(10);
    stop();
  });

  it('мовчить 2 ping поспіль - на третьому інтервалі розриваємо', () => {
    const alive = client();
    const silent = client();
    const stop = startHeartbeat(() => [alive, silent], { intervalMs: 1000, maxMissed: 2 });
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(1000);
      alive.missedPongs = 0;
    }
    expect(silent.dead).toBe(true);
    expect(silent.pings).toBe(2);
    expect(alive.dead).toBe(false);
    stop();
  });

  it('stop() зупиняє таймер', () => {
    const c = client();
    const stop = startHeartbeat(() => [c], { intervalMs: 1000, maxMissed: 2 });
    stop();
    vi.advanceTimersByTime(10_000);
    expect(c.pings).toBe(0);
  });
});
