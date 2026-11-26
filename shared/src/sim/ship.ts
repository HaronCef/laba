import { Entity } from './entity.ts';
import { Vector2, normalizeAngle } from './vector.ts';
import { Bullet } from './bullet.ts';
import { makeHoming } from './components/homing.ts';
import { ARENA, wrapValue } from './arena.ts';
import { DT } from './constants.ts';
import type { Input } from '../protocol.ts';
import type { Seq } from '../types.ts';
import type { PickupEffect } from './pickup.ts';
import type { World } from './world.ts';

// ---------- фізика (чиста функція, однакова на сервері і на клієнті) ----------

export const SHIP_SETTINGS = {
  turnSpeed: 3.5, // рад/с
  thrustPower: 260, // px/с^2
  drag: 0.5, // наскільки швидко корабель гальмує сам (1/с)
  maxSpeed: 380, // px/с
};

// Для експерименту з лаби 5: якщо увімкнути, integrate додає випадковий шум.
// Клієнт і сервер отримують різні числа -> прогноз розходиться з сервером.
let breakDeterminism = false;
export function setBreakDeterminism(on: boolean): void {
  breakDeterminism = on;
}

export interface Motion {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly angle: number;
}

type Controls = Pick<Input, 'turn' | 'thrust' | 'flip'>;

export function integrate(ship: Motion, input: Controls, dt: number): Motion {
  const s = SHIP_SETTINGS;

  let angle = ship.angle + input.turn * s.turnSpeed * dt;
  if (input.flip) angle += Math.PI; // розворот на 180°
  angle = normalizeAngle(angle);

  let vx = ship.vx;
  let vy = ship.vy;

  // тяга вздовж напрямку носа
  if (input.thrust) {
    vx += Math.cos(angle) * s.thrustPower * dt;
    vy += Math.sin(angle) * s.thrustPower * dt;
  }

  if (breakDeterminism) {
    vx += (Math.random() - 0.5) * 30; // НАВМИСНО ламає детермінізм
  }

  // опір: за 1 с швидкість множиться на e^(-drag)
  const k = Math.exp(-s.drag * dt);
  vx *= k;
  vy *= k;

  // обмеження швидкості
  const speed = Math.hypot(vx, vy);
  if (speed > s.maxSpeed) {
    vx = (vx / speed) * s.maxSpeed;
    vy = (vy / speed) * s.maxSpeed;
  }

  return { x: ship.x + vx * dt, y: ship.y + vy * dt, vx, vy, angle };
}

// Кулдауни рахуємо в кроках, а не в секундах: цілі числа однаково рахуються всюди
export const SHOT_COOLDOWN_STEPS = 5; // ~0.17 с
export const MISSILE_COOLDOWN_STEPS = 45; // 1.5 с
export const BULLET_SPEED = 520;
const NOSE = 18; // куля з'являється на 18 px попереду центру

export interface ShipState extends Motion {
  readonly shotCd: number;
  readonly missileCd: number;
  readonly triple: boolean;
}

export interface Shot extends Motion {
  readonly missile: boolean;
  readonly index: number; // 0..2 - звичайні кулі (3 при потрійному пострілі), 3 - ракета
}

function makeShot(s: Motion, angle: number, missile: boolean, index: number): Shot {
  return {
    x: wrapValue(s.x + Math.cos(s.angle) * NOSE, ARENA.width),
    y: wrapValue(s.y + Math.sin(s.angle) * NOSE, ARENA.height),
    vx: s.vx + Math.cos(angle) * BULLET_SPEED,
    vy: s.vy + Math.sin(angle) * BULLET_SPEED,
    angle,
    missile,
    index,
  };
}

// Один крок корабля за одним input. Цю функцію викликає і сервер (Ship.applyInput),
// і клієнт для прогнозу свого корабля, тому результат має бути однаковий.
export function stepShip(
  state: ShipState,
  input: Controls & Pick<Input, 'fire' | 'missile'>,
  dt: number = DT,
): { state: ShipState; shots: Shot[] } {
  const moved = integrate(state, input, dt);
  const x = wrapValue(moved.x, ARENA.width);
  const y = wrapValue(moved.y, ARENA.height);
  const pos: Motion = { ...moved, x, y };

  let shotCd = Math.max(0, state.shotCd - 1);
  let missileCd = Math.max(0, state.missileCd - 1);
  const shots: Shot[] = [];

  if (input.fire && shotCd === 0) {
    const spreads = state.triple ? [-0.2, 0, 0.2] : [0];
    spreads.forEach((spread, i) => shots.push(makeShot(pos, pos.angle + spread, false, i)));
    shotCd = SHOT_COOLDOWN_STEPS;
  }
  if (input.missile && missileCd === 0) {
    shots.push(makeShot(pos, pos.angle, true, 3));
    missileCd = MISSILE_COOLDOWN_STEPS;
  }

  return { state: { ...pos, shotCd, missileCd, triple: state.triple }, shots };
}

// номер кулі для мережі: з якого input і яка за рахунком (щоб клієнт впізнав свою кулю)
export function shotId(seq: Seq, index: number): number {
  return (seq * 4 + index) & 0xffff;
}

// ---------- клас корабля (живе на сервері) ----------

const MAX_HP = 100;
const RESPAWN_STEPS = 60; // 2 с

export class Ship extends Entity {
  readonly kind = 'ship';
  #hp = MAX_HP;
  readonly name: string;
  thrust = false;
  shotCd = 0;
  missileCd = 0;
  respawnSteps = 0; // > 0 - корабель знищений і чекає респауну
  readonly effects: Record<PickupEffect, number> = { shield: 0, triple: 0 }; // секунди дії бонусів
  deaths = 0;
  score = 0;

  constructor(pos: Vector2, name = '') {
    super({ pos, radius: 14, angle: -Math.PI / 2 });
    this.name = name;
  }

  get hp(): number {
    return this.#hp;
  }

  get isDead(): boolean {
    return this.respawnSteps > 0;
  }

  // повертає true, якщо корабель від цього удару знищено
  takeDamage(amount: number): boolean {
    if (this.isDead || this.effects.shield > 0) return false;

    this.#hp -= amount;
    if (this.#hp <= 0) {
      this.#hp = 0;
      this.respawnSteps = RESPAWN_STEPS;
      this.solid = false;
      this.deaths++;
      return true;
    }
    return false;
  }

  applyPickup(pickup: { readonly effect: PickupEffect; readonly duration: number }): void {
    this.effects[pickup.effect] = pickup.duration;
  }

  toState(): ShipState {
    return {
      x: this.pos.x,
      y: this.pos.y,
      vx: this.vel.x,
      vy: this.vel.y,
      angle: this.angle,
      shotCd: this.shotCd,
      missileCd: this.missileCd,
      triple: this.effects.triple > 0,
    };
  }

  // Сервер викликає це для кожного input гравця (з його seq)
  applyInput(input: Input, world: World): void {
    if (this.isDead) return;

    const { state, shots } = stepShip(this.toState(), input);
    this.pos = new Vector2(state.x, state.y);
    this.vel = new Vector2(state.vx, state.vy);
    this.angle = state.angle;
    this.shotCd = state.shotCd;
    this.missileCd = state.missileCd;
    this.thrust = input.thrust;

    for (const shot of shots) {
      const bullet = new Bullet({
        pos: new Vector2(shot.x, shot.y),
        vel: new Vector2(shot.vx, shot.vy),
        ownerId: this.netId,
        shotId: shotId(input.seq, shot.index),
        ...(shot.missile ? { ttl: 3, damage: 3, radius: 5 } : {}),
      });
      if (shot.missile) bullet.homing = makeHoming('asteroid', 4, 500);
      world.spawn(bullet);
    }
    // у JS тут було shots[0].missile - з noUncheckedIndexedAccess TypeScript вимагає перевірку
    const first = shots[0];
    if (first) {
      world.emit({ type: 'fired', ship: this.netId, missile: first.missile, x: this.pos.x, y: this.pos.y });
    }
  }

  // ефекти і респаун ідуть за часом сервера, а не за input
  override update(dt: number, world: World): void {
    if (this.isDead) {
      this.respawnSteps--;
      if (this.respawnSteps <= 0) this.respawn(world);
      return;
    }
    this.effects.shield = Math.max(0, this.effects.shield - dt);
    this.effects.triple = Math.max(0, this.effects.triple - dt);
  }

  respawn(world: World): void {
    this.respawnSteps = 0;
    this.#hp = MAX_HP;
    this.pos = world.findSafeSpot(150);
    this.vel = new Vector2(0, 0);
    this.angle = -Math.PI / 2;
    this.solid = true;
    this.effects.shield = 2; // 2 с захисту після появи
  }
}
