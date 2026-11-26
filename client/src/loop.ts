// Ігровий цикл з фіксованим кроком симуляції (Glenn Fiedler, "Fix Your Timestep!")

// Якщо кадр був дуже довгий (вкладка у фоні, фриз), беремо не більше 0.25 с,
// інакше симуляція почне наздоганяти сотні кроків ("spiral of death").
const MAX_DT = 0.25;

// Скільки секунд історії кадрів тримати для статистики
const HISTORY_SECONDS = 10;

export interface LoopStats {
  stepsPerSec: number;
  framesPerSec: number;
  frameTime: number; // мс між попереднім і цим кадром
  workTime: number; // мс, скільки виконувався сам кадр (simulate + render)
  minDt: number;
  maxDt: number;
  jitter: number; // стандартне відхилення dt за 10 с
}

export interface LoopOptions {
  step?: number;
  simulate: (dt: number) => void;
  render: (alpha: number) => void;
}

export function createLoop({ step = 1 / 60, simulate, render }: LoopOptions) {
  let running = false;
  let rafId = 0;
  let lastTime = 0;
  let accumulator = 0;

  let secondStart = 0;
  let stepsThisSecond = 0;
  let framesThisSecond = 0;
  let history: Array<{ time: number; dt: number }> = [];

  const stats: LoopStats = {
    stepsPerSec: 0,
    framesPerSec: 0,
    frameTime: 0,
    workTime: 0,
    minDt: 0,
    maxDt: 0,
    jitter: 0,
  };

  function updateHistoryStats(now: number): void {
    history = history.filter((item) => now - item.time <= HISTORY_SECONDS * 1000);
    if (history.length === 0) return;
    const dts = history.map((item) => item.dt);
    const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
    stats.minDt = Math.min(...dts);
    stats.maxDt = Math.max(...dts);
    stats.jitter = Math.sqrt(dts.reduce((a, b) => a + (b - avg) ** 2, 0) / dts.length);
  }

  function frame(now: number): void {
    if (!running) return;

    const workStart = performance.now();
    const dtMs = now - lastTime;
    lastTime = now;
    stats.frameTime = dtMs;
    history.push({ time: now, dt: dtMs });

    const dt = Math.min(MAX_DT, Math.max(0, dtMs / 1000));
    accumulator += dt;
    while (accumulator >= step) {
      simulate(step);
      accumulator -= step;
      stepsThisSecond++;
    }
    // alpha - яку частину наступного кроку ми вже "прожили" (від 0 до 1)
    render(accumulator / step);

    framesThisSecond++;
    stats.workTime = performance.now() - workStart;

    if (now - secondStart >= 1000) {
      const seconds = (now - secondStart) / 1000;
      stats.stepsPerSec = Math.round(stepsThisSecond / seconds);
      stats.framesPerSec = Math.round(framesThisSecond / seconds);
      stepsThisSecond = 0;
      framesThisSecond = 0;
      secondStart = now;
      updateHistoryStats(now);
    }

    rafId = requestAnimationFrame(frame);
  }

  function start(): void {
    if (running) return;
    running = true;
    lastTime = performance.now();
    secondStart = lastTime;
    accumulator = 0;
    history = [];
    rafId = requestAnimationFrame(frame);
  }

  function stop(): void {
    running = false;
    cancelAnimationFrame(rafId);
  }

  return { start, stop, stats };
}
