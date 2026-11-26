import { Asteroid } from './asteroid.js';
import { Explosion } from './explosion.js';
import { Vector2 } from './vector.js';

// Що робити, коли дві сутності зіткнулись.

// з пари [a, b] повертає ту, що підходить під умову (або null)
function pick(a, b, test) {
  if (test(a)) return a;
  if (test(b)) return b;
  return null;
}

function other(pair, one) {
  return pair[0] === one ? pair[1] : pair[0];
}

function destroyAsteroid(world, asteroid) {
  world.despawn(asteroid.id);
  world.spawn(new Explosion({ pos: asteroid.pos, count: asteroid.size * 10 }));
  world.emit('exploded', { kind: 'asteroid', pos: asteroid.pos });
  world.addScore(asteroid.size === 2 ? 50 : 100, asteroid.pos);

  // великий розпадається на два маленьких
  if (asteroid.size === 2) {
    for (let i = 0; i < 2; i++) {
      const vel = Vector2.fromAngle(Math.random() * Math.PI * 2, 60 + Math.random() * 60);
      world.spawn(new Asteroid({ pos: asteroid.pos, vel, size: 1 }));
    }
  }
}

function destroyShip(world, ship) {
  world.spawn(new Explosion({ pos: ship.pos, count: 30, color: '#8fa2ff' }));
  world.emit('exploded', { kind: 'ship', pos: ship.pos });
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
      world.emit('hit', { target: 'asteroid', pos: bullet.pos });
      if (target.takeDamage(bullet.damage)) destroyAsteroid(world, target);
    } else if (target.kind === 'ship' && target.id !== bullet.ownerId) {
      world.despawn(bullet.id);
      world.emit('hit', { target: 'ship', pos: bullet.pos });
      if (target.takeDamage(bullet.damage * 10)) destroyShip(world, target);
    }
    return; // кулі не підбирають бонуси і не б'ються одна об одну
  }

  const ship = pick(a, b, (e) => e.kind === 'ship');
  if (!ship) return;
  const thing = other(pair, ship);

  // корабель + астероїд
  if (thing.kind === 'asteroid') {
    world.emit('hit', { target: 'ship', pos: ship.pos });
    destroyAsteroid(world, thing);
    if (ship.takeDamage(thing.size === 2 ? 40 : 20)) destroyShip(world, ship);
    return;
  }

  // корабель + будь-що з компонентом pickup
  if (thing.pickup) {
    ship.applyPickup(thing.pickup);
    world.despawn(thing.id);
    world.emit('pickup', { effect: thing.pickup.effect, pos: thing.pos });
  }
}
