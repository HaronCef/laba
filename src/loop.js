// Ігровий цикл з фіксованим кроком симуляції (Glenn Fiedler, "Fix Your Timestep!")

// Якщо кадр був дуже довгий (вкладка у фоні, фриз), беремо не більше 0.25 с,
// інакше симуляція почне наздоганяти сотні кроків ("spiral of death").
const MAX_DT = 0.25;

// Скільки секунд історії кадрів тримати для статистики (для експерименту 2)
const HISTORY_SECONDS = 10;

// options.useInterval = true  -> setInterval(frame, 16) замість rAF (експеримент 2)
// options.fixedStep = false   -> один simulate(dt) на кадр без акумулятора (експеримент 3)
export function createLoop({
  step = 1 / 60,
  simulate,
  render,
  useInterval = false,
  fixedStep = true,
}) {
  let running = false;
  let rafId = 0;
  let intervalId = 0;
  let lastTime = 0;
  let accumulator = 0;

  // лічильники за поточну секунду
  let secondStart = 0;
  let stepsThisSecond = 0;
  let framesThisSecond = 0;

  // історія тривалостей кадрів за останні 10 с: { time, dt }
  let history = [];

  const stats = {
    stepsPerSec: 0,
    framesPerSec: 0,
    frameTime: 0, // мс між попереднім і цим кадром
    workTime: 0, // мс, скільки виконувався сам кадр (simulate + render)
    minDt: 0,
    maxDt: 0,
    jitter: 0, // стандартне відхилення dt за 10 с
  };

  function updateHistoryStats(now) {
    history = history.filter((item) => now - item.time <= HISTORY_SECONDS * 1000);
    if (history.length === 0) return;

    let min = Infinity;
    let max = 0;
    let sum = 0;
    for (const item of history) {
      if (item.dt < min) min = item.dt;
      if (item.dt > max) max = item.dt;
      sum += item.dt;
    }
    const avg = sum / history.length;

    let sq = 0;
    for (const item of history) {
      sq += (item.dt - avg) ** 2;
    }

    stats.minDt = min;
    stats.maxDt = max;
    stats.jitter = Math.sqrt(sq / history.length);
  }

  function frame(now) {
    if (!running) return;

    const workStart = performance.now();
    const dtMs = now - lastTime;
    lastTime = now;
    stats.frameTime = dtMs;
    history.push({ time: now, dt: dtMs });

    let dt = dtMs / 1000;
    if (dt > MAX_DT) dt = MAX_DT;
    if (dt < 0) dt = 0;

    if (fixedStep) {
      accumulator += dt;
      while (accumulator >= step) {
        simulate(step);
        accumulator -= step;
        stepsThisSecond++;
      }
      // alpha - яку частину наступного кроку ми вже "прожили" (від 0 до 1)
      render(accumulator / step);
    } else {
      simulate(dt);
      stepsThisSecond++;
      render(1);
    }

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

    if (!useInterval) {
      rafId = requestAnimationFrame(frame);
    }
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    secondStart = lastTime;
    accumulator = 0;
    history = [];

    if (useInterval) {
      intervalId = setInterval(() => frame(performance.now()), 16);
    } else {
      rafId = requestAnimationFrame(frame);
    }
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    clearInterval(intervalId);
  }

  return { start, stop, stats };
}
