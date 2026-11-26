import { normalizeAngle } from './vector.ts';
import { mulberry32, type Rng } from '../rng.ts';
import { asSeq, type Seq } from '../types.ts';
import type { Input } from '../protocol.ts';
import type { Ship } from './ship.ts';
import type { AnyEntity, World } from './world.ts';

// Звідки корабель бере команди: від людини (по мережі) або від бота.
export interface PlayerInput {
  // input-и на цей крок
  take(world: World, ship: Ship): readonly Input[];
}

export type BotMode = 'chase' | 'evade';

const DANGER_DIST = 110; // ближче - тікаємо від астероїда
const FIRE_ANGLE = 0.25; // стріляємо, якщо ціль майже по носу (рад)
const FIRE_DIST = 520;
const THRUST_DIST = 220; // далі - летимо до цілі

// Простий бот: летить до найближчої цілі і стріляє, від близького астероїда тікає.
// Дає такий самий Input, як людина.
export class Bot implements PlayerInput {
  readonly #rng: Rng;
  #seq = 0;
  #wobble = 0; // трохи рандому, щоб боти літали по-різному
  mode: BotMode = 'chase';

  constructor(seed: number) {
    this.#rng = mulberry32(seed);
  }

  take(world: World, ship: Ship): readonly Input[] {
    return [this.think(world, ship)];
  }

  think(world: World, ship: Ship): Input {
    const seq: Seq = asSeq(++this.#seq);
    if (ship.isDead) return { seq, turn: 0, thrust: false, fire: false, missile: false, flip: false };

    if (this.#rng() < 0.05) this.#wobble = (this.#rng() - 0.5) * 0.6;

    // шукаємо найближчий астероїд і найближчу ціль
    let threat: AnyEntity | null = null;
    let threatDist = DANGER_DIST;
    let target: AnyEntity | null = null;
    let targetDist = Infinity;
    for (const e of world) {
      if (!e.alive || !e.solid || e === ship) continue;
      if (e.kind !== 'asteroid' && e.kind !== 'ship') continue;
      const d = Math.hypot(e.pos.x - ship.pos.x, e.pos.y - ship.pos.y);
      if (e.kind === 'asteroid' && d - e.radius < threatDist) {
        threat = e;
        threatDist = d - e.radius;
      }
      if (d < targetDist) {
        target = e;
        targetDist = d;
      }
    }

    if (threat) {
      // тікаємо від астероїда
      this.mode = 'evade';
      const away = Math.atan2(ship.pos.y - threat.pos.y, ship.pos.x - threat.pos.x);
      return { seq, turn: turnTo(ship.angle, away), thrust: true, fire: false, missile: false, flip: false };
    }

    this.mode = 'chase';
    if (!target) return { seq, turn: 1, thrust: false, fire: false, missile: false, flip: false };

    const want = Math.atan2(target.pos.y - ship.pos.y, target.pos.x - ship.pos.x) + this.#wobble;
    const diff = Math.abs(normalizeAngle(want - ship.angle));
    return {
      seq,
      turn: turnTo(ship.angle, want),
      thrust: targetDist > THRUST_DIST,
      fire: diff < FIRE_ANGLE && targetDist < FIRE_DIST,
      missile: diff < FIRE_ANGLE && targetDist > 300,
      flip: false,
    };
  }
}

// куди повертати, щоб дивитись на кут want
export function turnTo(angle: number, want: number): -1 | 0 | 1 {
  const diff = normalizeAngle(want - angle);
  if (diff > 0.08) return 1;
  if (diff < -0.08) return -1;
  return 0;
}
