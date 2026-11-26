import { Entity } from './entity.js';
import { Vector2, normalizeAngle } from './vector.js';
import { Bullet } from './bullet.js';
import { makeHoming } from './components/homing.js';

// ---------- фізика з лаби 1 (чиста функція, без DOM) ----------

export const SHIP_SETTINGS = {
  turnSpeed: 3.5, // рад/с
  thrustPower: 260, // px/с^2
  drag: 0.5, // наскільки швидко корабель гальмує сам (1/с)
  maxSpeed: 380, // px/с
};

// ship - звичайний об'єкт { x, y, vx, vy, angle }
// input - звичайний об'єкт { left, right, thrust, flip }
export function integrate(ship, input, dt) {
  const s = SHIP_SETTINGS;

  let angle = ship.angle;
  if (input.left) angle -= s.turnSpeed * dt;
  if (input.right) angle += s.turnSpeed * dt;
  if (input.flip) angle += Math.PI; // розворот на 180°
  angle = normalizeAngle(angle);

  let vx = ship.vx;
  let vy = ship.vy;

  // тяга вздовж напрямку носа
  if (input.thrust) {
    vx += Math.cos(angle) * s.thrustPower * dt;
    vy += Math.sin(angle) * s.thrustPower * dt;
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

  return {
    x: ship.x + vx * dt,
    y: ship.y + vy * dt,
    vx,
    vy,
    angle,
    thrust: input.thrust,
  };
}

// ---------- клас корабля (лаба 2) ----------

const MAX_HP = 100;
const SHOT_COOLDOWN = 0.18; // с між звичайними пострілами
const MISSILE_COOLDOWN = 1.5; // с між ракетами
const RESPAWN_TIME = 2;
const BULLET_SPEED = 520;

const NO_INPUT = { left: false, right: false, thrust: false, flip: false };

export class Ship extends Entity {
  #hp = MAX_HP;

  constructor(pos) {
    super({ pos, radius: 14, kind: 'ship', angle: -Math.PI / 2 });
    this.thrust = false;
    this.controls = NO_INPUT; // World кладе сюди керування перед update
    this.shotQueued = false;
    this.missileQueued = false;
    this.shotCooldown = 0;
    this.missileCooldown = 0;
    this.respawnTimer = 0; // > 0 - корабель знищений і чекає респауну
    this.effects = { shield: 0, triple: 0 }; // секунди дії бонусів
    this.deaths = 0;
  }

  get hp() {
    return this.#hp;
  }

  get isDead() {
    return this.respawnTimer > 0;
  }

  // Ці два методи викликаються зі слухача клавіатури. Самі вони нічого не
  // створюють, а лише ставлять постріл у чергу - куля з'явиться в update().
  fire() {
    this.shotQueued = true;
  }

  fireMissile() {
    this.missileQueued = true;
  }

  // повертає true, якщо корабель від цього удару знищено
  takeDamage(amount) {
    if (this.isDead || this.effects.shield > 0) return false;

    this.#hp -= amount;
    if (this.#hp <= 0) {
      this.#hp = 0;
      this.respawnTimer = RESPAWN_TIME;
      this.solid = false;
      this.deaths++;
      return true;
    }
    return false;
  }

  applyPickup(pickup) {
    this.effects[pickup.effect] = pickup.duration;
  }

  update(dt, world) {
    if (this.isDead) {
      this.shotQueued = false;
      this.missileQueued = false;
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.respawn(world);
      }
      return;
    }

    // рух - та сама чиста функція integrate() з лаби 1
    const next = integrate(
      { x: this.pos.x, y: this.pos.y, vx: this.vel.x, vy: this.vel.y, angle: this.angle },
      this.controls,
      dt,
    );
    this.pos = new Vector2(next.x, next.y);
    this.vel = new Vector2(next.vx, next.vy);
    this.angle = next.angle;
    this.thrust = next.thrust;

    this.shotCooldown -= dt;
    this.missileCooldown -= dt;
    this.effects.shield = Math.max(0, this.effects.shield - dt);
    this.effects.triple = Math.max(0, this.effects.triple - dt);

    if (this.shotQueued && this.shotCooldown <= 0) {
      this.shoot(world);
      this.shotCooldown = SHOT_COOLDOWN;
    }
    if (this.missileQueued && this.missileCooldown <= 0) {
      this.launchMissile(world);
      this.missileCooldown = MISSILE_COOLDOWN;
    }
    this.shotQueued = false;
    this.missileQueued = false;
  }

  // куля з'являється біля носа і отримує швидкість корабля + свою
  makeBullet(angle, options) {
    const nose = this.pos.add(Vector2.fromAngle(this.angle, this.radius + 4));
    const vel = this.vel.add(Vector2.fromAngle(angle, BULLET_SPEED));
    return new Bullet({ pos: nose, vel, ownerId: this.id, ...options });
  }

  shoot(world) {
    if (this.effects.triple > 0) {
      for (const spread of [-0.2, 0, 0.2]) {
        world.spawn(this.makeBullet(this.angle + spread));
      }
    } else {
      world.spawn(this.makeBullet(this.angle));
    }
    world.emit('fired', { shipId: this.id, missile: false });
  }

  // ракета - це звичайна куля, до якої додали компонент homing
  launchMissile(world) {
    const missile = this.makeBullet(this.angle, { ttl: 3, damage: 3, radius: 5 });
    missile.homing = makeHoming('asteroid', 4, 500);
    world.spawn(missile);
    world.emit('fired', { shipId: this.id, missile: true });
  }

  respawn(world) {
    this.respawnTimer = 0;
    this.#hp = MAX_HP;
    this.pos = world.findSafeSpot(150);
    this.vel = new Vector2(0, 0);
    this.angle = -Math.PI / 2;
    this.savePrevious();
    this.solid = true;
    this.effects.shield = 2; // 2 с захисту після появи
  }
}
