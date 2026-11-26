import { stepShip } from './sim/ship.js';
import { hashNumbers } from './hash.js';

// Однаковий "сценарій" input для перевірки детермінізму: 1000 кроків
export function scriptedInput(i) {
  return {
    seq: i,
    turn: i % 90 < 30 ? 1 : i % 90 < 45 ? -1 : 0,
    thrust: i % 7 !== 0,
    fire: i % 3 === 0,
    missile: i % 200 === 0,
    flip: i % 250 === 125,
  };
}

// Прогнати корабель 1000 кроків і повернути хеш кінцевого стану
export function runScriptedShip(steps = 1000) {
  let state = {
    x: 640,
    y: 360,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    shotCd: 0,
    missileCd: 0,
    triple: false,
  };
  for (let i = 0; i < steps; i++) {
    state = stepShip(state, scriptedInput(i)).state;
  }
  return hashNumbers([state.x, state.y, state.vx, state.vy, state.angle]);
}
