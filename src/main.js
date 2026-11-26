import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { createShip, integrate } from './sim/ship.js';
import { createArena, wrapShip } from './sim/arena.js';
import { setupCanvas } from './render/canvas.js';
import {
  createStars,
  drawBackground,
  drawShip,
  drawHud,
  interpolateShip,
} from './render/draw.js';

const exp = new URLSearchParams(location.search).get('exp');

const MODE_NAMES = {
  1: 'exp 1: 100 ms блок кожен 60-й кадр',
  2: 'exp 2: setInterval(frame, 16)',
  3: 'exp 3: змінний крок, без акумулятора',
};

const canvas = document.getElementById('game');
const arena = createArena(800, 600);
const { ctx, size } = setupCanvas(canvas, (w, h) => {
  arena.width = w;
  arena.height = h;
});

const input = createInput(window);
const stars = createStars(180);

let current = createShip(arena.width / 2, arena.height / 2);
let previous = current;

// для експерименту 3: скільки секунд тримаємо тягу і скільки пролетіли
let thrustTime = 0;
let distance = 0;
let result5s = null;

function resetShip() {
  current = createShip(arena.width / 2, arena.height / 2);
  previous = current;
  thrustTime = 0;
  distance = 0;
  result5s = null;
}

function readControls() {
  return {
    left: input.isDown('ArrowLeft') || input.isDown('KeyA'),
    right: input.isDown('ArrowRight') || input.isDown('KeyD'),
    thrust: input.isDown('ArrowUp') || input.isDown('KeyW'),
    flip: input.justPressed('Space'),
  };
}

function simulate(dt) {
  if (input.justPressed('KeyR')) {
    resetShip();
  }

  const controls = readControls();
  previous = current;
  current = wrapShip(integrate(current, controls, dt), arena);

  if (controls.thrust && result5s === null) {
    thrustTime += dt;
    distance += Math.hypot(current.vx, current.vy) * dt;
    if (thrustTime >= 5 - 1e-9) {
      result5s = distance;
      console.log(`[exp3] за 5 с тяги пролетіли ${distance.toFixed(2)} px`);
    }
  }

  input.endStep();
}

let frameNumber = 0;

function busyWait(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // нічого не робимо, просто тримаємо потік
  }
}

function render(alpha) {
  frameNumber++;
  if (exp === '1' && frameNumber % 60 === 0) {
    busyWait(100);
  }

  const ship = interpolateShip(previous, current, alpha, arena);
  const s = loop.stats;

  drawBackground(ctx, size.width, size.height, stars);
  drawShip(ctx, ship);
  drawHud(ctx, [
    `steps/s:    ${s.stepsPerSec}`,
    `frames/s:   ${s.framesPerSec}`,
    `frame time: ${s.frameTime.toFixed(1)} ms (робота ${s.workTime.toFixed(2)} ms)`,
    `10 s: dt ${s.minDt.toFixed(1)}..${s.maxDt.toFixed(1)} ms, jitter ${s.jitter.toFixed(2)}`,
    `speed: ${Math.round(Math.hypot(current.vx, current.vy))} px/s`,
    `тяга: ${thrustTime.toFixed(2)} s, шлях ${distance.toFixed(1)} px`,
    result5s === null ? 'шлях за 5 с: -' : `шлях за 5 с: ${result5s.toFixed(2)} px`,
    MODE_NAMES[exp] || 'режим: rAF + фіксований крок',
    'W/↑ тяга, A/D ←/→ поворот, Space розворот, R скинути',
  ]);
}

const loop = createLoop({
  step: 1 / 60,
  simulate,
  render,
  useInterval: exp === '2',
  fixedStep: exp !== '3',
});

loop.start();
