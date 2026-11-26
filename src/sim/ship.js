// Фізика корабля. Тут немає DOM і canvas - тільки числа.
// integrate() не змінює старий об'єкт, а повертає новий стан.

export const SHIP_SETTINGS = {
  turnSpeed: 3.5, // рад/с
  thrustPower: 260, // px/с^2
  drag: 0.5, // наскільки швидко корабель гальмує сам (1/с)
  maxSpeed: 380, // px/с
};

export function createShip(x, y) {
  return { x, y, vx: 0, vy: 0, angle: -Math.PI / 2, thrust: false };
}

// кут у межах [-PI, PI)
export function normalizeAngle(angle) {
  const full = Math.PI * 2;
  return angle - full * Math.floor((angle + Math.PI) / full);
}

// input - звичайний об'єкт { left, right, thrust, flip }
export function integrate(ship, input, dt) {
  const s = SHIP_SETTINGS;

  let angle = ship.angle;
  if (input.left) angle -= s.turnSpeed * dt;
  if (input.right) angle += s.turnSpeed * dt;
  if (input.flip) angle += Math.PI; // розворот на 180° по Space
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
