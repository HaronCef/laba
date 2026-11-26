import { mark, measure } from './perf.ts';

// Ігровий цикл з фіксованим кроком симуляції (Glenn Fiedler, "Fix Your Timestep!")

// Якщо кадр був дуже довгий (вкладка у фоні, фриз), беремо не більше 0.25 с,
// інакше симуляція почне наздоганяти сотні кроків ("spiral of death").
const MAX_DT = 0.25;

// Скільки секунд історії кадрів тримати для статистики
const HISTORY_SECONDS = 10;
const HISTORY_SIZE = 1024; // ~17 с при 60 fps

export interface LoopStats {
  stepsPerSec: number;
  framesPerSec: number;
  frameTime: number; // мс між попереднім і цим кадром
  workTime: number; // мс, скільки виконувався сам кадр (simulate + render)
  minDt: number;
  maxDt: number;
  jitter: number; // стандартне відхилення dt за 10 с
}

// Звідки брати час і як просити кадр: у браузері - requestAnimationFrame, у тестах - setTimeout.
export interface Scheduler {
  now(): number;
  request(cb: (time: number) => void): number;
  cancel(id: number): void;
}

export const browserScheduler: Scheduler = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};

export interface LoopOptions {
  step?: number;
  simulate: (dt: number) => void;
  render: (alpha: number) => void;
  scheduler?: Scheduler;
}

export function createLoop({ step = 1 / 60, simulate, render, scheduler = browserScheduler }: LoopOptions) {
  let running = false;
  let rafId = 0;
  let lastTime = 0;
  let accumulator = 0;

  let secondStart = 0;
  let stepsThisSecond = 0;
  let framesThisSecond = 0;
  // історія dt - кільцевий буфер, щоб не створювати об'єкти кожен кадр
  const histTime = new Float64Array(HISTORY_SIZE);
  const histDt = new Float64Array(HISTORY_SIZE);
  let histCount = 0; // скільки всього записали

  const stats: LoopStats = { stepsPerSec: 0, framesPerSec: 0, frameTime: 0, workTime: 0, minDt: 0, maxDt: 0, jitter: 0 };

  // мін/макс/джитер dt за останні 10 с (раз на секунду)
  function updateHistoryStats(now: number): void {
    const n = Math.min(histCount, HISTORY_SIZE);
    let count = 0;
    let sum = 0;
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < n; i++) {
      if (now - (histTime[i] ?? 0) > HISTORY_SECONDS * 1000) continue;
      const dt = histDt[i] ?? 0;
      count++;
      sum += dt;
      if (dt < min) min = dt;
      if (dt > max) max = dt;
    }
    if (count === 0) return;
    const avg = sum / count;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      if (now - (histTime[i] ?? 0) > HISTORY_SECONDS * 1000) continue;
      sq += ((histDt[i] ?? 0) - avg) ** 2;
    }
    stats.minDt = min;
    stats.maxDt = max;
    stats.jitter = Math.sqrt(sq / count);
  }

  function frame(now: number): void {
    if (!running) return;

    mark('frame-start');
    const workStart = scheduler.now();
    const dtMs = now - lastTime;
    lastTime = now;
    stats.frameTime = dtMs;
    histTime[histCount % HISTORY_SIZE] = now;
    histDt[histCount % HISTORY_SIZE] = dtMs;
    histCount++;

    const dt = Math.min(MAX_DT, Math.max(0, dtMs / 1000));
    accumulator += dt;
    while (accumulator >= step) {
      mark('simulate-start');
      simulate(step);
      measure('simulate', 'simulate-start');
      accumulator -= step;
      stepsThisSecond++;
    }
    // alpha - яку частину наступного кроку ми вже "прожили" (від 0 до 1)
    mark('render-start');
    render(accumulator / step);
    measure('render', 'render-start');

    framesThisSecond++;
    stats.workTime = scheduler.now() - workStart;
    measure('frame', 'frame-start');

    if (now - secondStart >= 1000) {
      const seconds = (now - secondStart) / 1000;
      stats.stepsPerSec = Math.round(stepsThisSecond / seconds);
      stats.framesPerSec = Math.round(framesThisSecond / seconds);
      stepsThisSecond = 0;
      framesThisSecond = 0;
      secondStart = now;
      updateHistoryStats(now);
    }

    rafId = scheduler.request(frame);
  }

  function start(): void {
    if (running) return;
    running = true;
    lastTime = scheduler.now();
    secondStart = lastTime;
    accumulator = 0;
    histCount = 0;
    rafId = scheduler.request(frame);
  }

  function stop(): void {
    running = false;
    scheduler.cancel(rafId);
  }

  return { start, stop, stats };
}
