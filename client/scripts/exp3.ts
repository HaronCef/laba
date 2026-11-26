// Експеримент 3 без браузера: та сама integrate(), але різні частоти кадрів.
// Запуск: npm run exp3 --workspace=client

import { integrate, type Motion } from 'shared/sim/ship.ts';

function createShip(): Motion {
  return { x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2 };
}

const STEP = 1 / 60;
const TIME = 5;
const controls = { turn: 0, thrust: true, flip: false } satisfies Parameters<typeof integrate>[1];

// послідовність тривалостей кадрів (у секундах) на 5 секунд
function makeFrames(fps: number, jitter: number): number[] {
  const frames: number[] = [];
  let total = 0;
  let seed = 1;
  while (total < TIME - 1e-9) {
    seed = (seed * 16807) % 2147483647; // простий псевдовипадковий генератор
    const noise = (seed / 2147483647 - 0.5) * 2 * jitter;
    let dt = 1 / fps + noise;
    if (total + dt > TIME) dt = TIME - total;
    frames.push(dt);
    total += dt;
  }
  return frames;
}

function runVariable(frames: readonly number[]): number {
  let ship = createShip();
  let path = 0;
  for (const dt of frames) {
    ship = integrate(ship, controls, dt);
    path += Math.hypot(ship.vx, ship.vy) * dt;
  }
  return path;
}

function runFixed(frames: readonly number[]): { path: number; steps: number } {
  let ship = createShip();
  let path = 0;
  let acc = 0;
  let steps = 0;
  for (const dt of frames) {
    acc += Math.min(dt, 0.25);
    while (acc >= STEP - 1e-9 && steps < TIME / STEP) {
      ship = integrate(ship, controls, STEP);
      path += Math.hypot(ship.vx, ship.vy) * STEP;
      acc -= STEP;
      steps++;
    }
  }
  return { path, steps };
}

const cases: Array<[string, number[]]> = [
  ['60 Hz', makeFrames(60, 0)],
  ['144 Hz', makeFrames(144, 0)],
  ['~10 fps (CPU 6x), jitter ±20 ms', makeFrames(10, 0.02)],
];

console.log('Шлях за 5 с утримання тяги (px):');
for (const [name, frames] of cases) {
  const fixed = runFixed(frames);
  console.log(
    `${name.padEnd(34)} змінний крок: ${runVariable(frames).toFixed(2).padStart(8)}` +
      `   фіксований: ${fixed.path.toFixed(2).padStart(8)} (${fixed.steps} кроків)`,
  );
}
