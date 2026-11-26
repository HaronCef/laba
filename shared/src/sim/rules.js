import { Asteroid } from './asteroid.js';
import { Vector2 } from './vector.js';

// Що робити, коли дві сутності зіткнулись.
// Вибухи тепер малює клієнт: сервер лише кладе подію 'exploded' у world.events.

// з пари [a, b] повертає ту, що підходить під умову (або null)
function pick(a, b, test) {
  if (test(a)) return a;
  if (test(b)) return b;
  return null;
}

function other(pair, one) {
  return pair[0] === one ? pair[1] : pair[0];
}

function destroyAsteroid(world, asteroid, byShipNetId) {
  world.despawn(asteroid.id);
  world.emit('exploded', {
    kind: 'asteroid',
    x: asteroid.pos.x,
    y: asteroid.pos.y,
    size: asteroid.size,
  });
  world.addScore(byShipNetId, asteroid.size === 2 ? 50 : 100, asteroid.pos);

  // великий розпадається на два маленьких
  if (asteroid.size === 2) {
    for (let i = 0; i < 2; i++) {
      const vel = Vector2.fromAngle(world.rng() * Math.PI * 2, 60 + world.rng() * 60);
      const spin = (world.rng() - 0.5) * 2;
      world.spawn(new Asteroid({ pos: asteroid.pos, vel, size: 1, spin }));
    }
  }
}

function destroyShip(world, ship, byShipNetId) {
  world.emit('exploded', {
    kind: 'ship',
    x: ship.pos.x,
    y: ship.pos.y,
    ship: ship.netId,
  });
  world.addScore(byShipNetId, 200, ship.pos);
}

export function handleCollision(world, a, b) {
  if (!a.alive || !b.alive || !a.solid || !b.solid) return;
  const pair = [a, b];

  // куля + щось
  const bullet = pick(a, b, (e) => e.kind === 'bullet');
  if (bullet) {
    const target = other(pair, bullet);
    if (target.kind === 'asteroid') {
      world.despawn(bullet.id);
      world.emit('hit', { target: 'asteroid', x: bullet.pos.x, y: bullet.pos.y });
      if (target.takeDamage(bullet.damage))
        destroyAsteroid(world, target, bullet.ownerId);
    } else if (target.kind === 'ship' && target.netId !== bullet.ownerId) {
      world.despawn(bullet.id);
      world.emit('hit', {
        target: 'ship',
        x: bullet.pos.x,
        y: bullet.pos.y,
        ship: target.netId,
      });
      if (target.takeDamage(bullet.damage * 10))
        destroyShip(world, target, bullet.ownerId);
    }
    return; // кулі не підбирають бонуси і не б'ються одна об одну
  }

  const ship = pick(a, b, (e) => e.kind === 'ship');
  if (!ship) return;
  const thing = other(pair, ship);

  // корабель + астероїд
  if (thing.kind === 'asteroid') {
    world.emit('hit', { target: 'ship', x: ship.pos.x, y: ship.pos.y, ship: ship.netId });
    destroyAsteroid(world, thing, 0);
    if (ship.takeDamage(thing.size === 2 ? 40 : 20)) destroyShip(world, ship, 0);
    return;
  }

  // корабель + будь-що з компонентом pickup
  if (thing.pickup) {
    ship.applyPickup(thing.pickup);
    world.despawn(thing.id);
    world.emit('pickup', {
      effect: thing.pickup.effect,
      ship: ship.netId,
      x: thing.pos.x,
      y: thing.pos.y,
    });
  }
}
