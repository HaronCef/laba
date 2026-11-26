import { Entity } from './entity.js';
import { Vector2, normalizeAngle } from './vector.js';
import { Bullet } from './bullet.js';
import { makeHoming } from './components/homing.js';
import { ARENA, wrapValue } from './arena.js';
import { DT } from './constants.js';

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
export function setBreakDeterminism(on) {
  breakDeterminism = on;
}

// ship - { x, y, vx, vy, angle }, input - { turn: -1|0|1, thrust, flip }
export function integrate(ship, input, dt) {
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

function makeShot(s, angle, missile, index) {
  return {
    x: wrapValue(s.x + Math.cos(s.angle) * NOSE, ARENA.width),
    y: wrapValue(s.y + Math.sin(s.angle) * NOSE, ARENA.height),
    vx: s.vx + Math.cos(angle) * BULLET_SPEED,
    vy: s.vy + Math.sin(angle) * BULLET_SPEED,
    angle,
    missile,
    index, // 0..2 - звичайні кулі (3 при потрійному пострілі), 3 - ракета
  };
}

// Один крок корабля за одним input. Цю функцію викликає і сервер (Ship.applyInput),
// і клієнт для прогнозу свого корабля, тому результат має бути однаковий.
// state: { x, y, vx, vy, angle, shotCd, missileCd, triple }
// повертає { state, shots }
export function stepShip(state, input, dt = DT) {
  const moved = integrate(state, input, dt);
  moved.x = wrapValue(moved.x, ARENA.width);
  moved.y = wrapValue(moved.y, ARENA.height);

  let shotCd = Math.max(0, state.shotCd - 1);
  let missileCd = Math.max(0, state.missileCd - 1);
  const shots = [];

  if (input.fire && shotCd === 0) {
    const spreads = state.triple ? [-0.2, 0, 0.2] : [0];
    spreads.forEach((spread, i) =>
      shots.push(makeShot(moved, moved.angle + spread, false, i)),
    );
    shotCd = SHOT_COOLDOWN_STEPS;
  }
  if (input.missile && missileCd === 0) {
    shots.push(makeShot(moved, moved.angle, true, 3));
    missileCd = MISSILE_COOLDOWN_STEPS;
  }

  return { state: { ...moved, shotCd, missileCd, triple: state.triple }, shots };
}

// номер кулі для мережі: з якого input і яка за рахунком (щоб клієнт впізнав свою кулю)
export function shotId(seq, index) {
  return (seq * 4 + index) & 0xffff;
}

// ---------- клас корабля (живе на сервері) ----------

const MAX_HP = 100;
const RESPAWN_STEPS = 60; // 2 с

export class Ship extends Entity {
  #hp = MAX_HP;

  constructor(pos, { playerId = 0, name = '' } = {}) {
    super({ pos, radius: 14, kind: 'ship', angle: -Math.PI / 2 });
    this.playerId = playerId;
    this.name = name;
    this.thrust = false;
    this.shotCd = 0;
    this.missileCd = 0;
    this.respawnSteps = 0; // > 0 - корабель знищений і чекає респауну
    this.effects = { shield: 0, triple: 0 }; // секунди дії бонусів
    this.deaths = 0;
    this.score = 0;
  }

  get hp() {
    return this.#hp;
  }

  get isDead() {
    return this.respawnSteps > 0;
  }

  // повертає true, якщо корабель від цього удару знищено
  takeDamage(amount) {
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

  applyPickup(pickup) {
    this.effects[pickup.effect] = pickup.duration;
  }

  toState() {
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
  applyInput(input, world) {
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
    if (shots.length > 0) {
      world.emit('fired', {
        ship: this.netId,
        missile: shots[0].missile,
        x: this.pos.x,
        y: this.pos.y,
      });
    }
  }

  // ефекти і респаун ідуть за часом сервера, а не за input
  update(dt, world) {
    if (this.isDead) {
      this.respawnSteps--;
      if (this.respawnSteps <= 0) this.respawn(world);
      return;
    }
    this.effects.shield = Math.max(0, this.effects.shield - dt);
    this.effects.triple = Math.max(0, this.effects.triple - dt);
  }

  respawn(world) {
    this.respawnSteps = 0;
    this.#hp = MAX_HP;
    this.pos = world.findSafeSpot(150);
    this.vel = new Vector2(0, 0);
    this.angle = -Math.PI / 2;
    this.solid = true;
    this.effects.shield = 2; // 2 с захисту після появи
  }
}
