import { Asteroid } from './asteroid.ts';
import { Vector2 } from './vector.ts';
import { assertNever, type EntityId } from '../types.ts';
import type { Bullet } from './bullet.ts';
import type { Ship } from './ship.ts';
import type { AnyEntity, World } from './world.ts';

// Що робити, коли дві сутності зіткнулись.
// Вибухи малює клієнт: сервер лише кладе подію 'exploded' у world.events.

function destroyAsteroid(world: World, asteroid: Asteroid, by: EntityId | null): void {
  world.despawn(asteroid.id);
  world.emit({
    type: 'exploded',
    kind: 'asteroid',
    x: asteroid.pos.x,
    y: asteroid.pos.y,
    size: asteroid.size,
  });
  world.addScore(by, asteroid.size === 2 ? 50 : 100, asteroid.pos);

  // великий розпадається на два маленьких
  if (asteroid.size === 2) {
    for (let i = 0; i < 2; i++) {
      const vel = Vector2.fromAngle(world.rng() * Math.PI * 2, 60 + world.rng() * 60);
      const spin = (world.rng() - 0.5) * 2;
      world.spawn(new Asteroid({ pos: asteroid.pos, vel, size: 1, spin }));
    }
  }
}

function destroyShip(world: World, ship: Ship, by: EntityId | null): void {
  world.emit({
    type: 'exploded',
    kind: 'ship',
    x: ship.pos.x,
    y: ship.pos.y,
    ship: ship.netId,
  });
  world.addScore(by, 200, ship.pos);
}

function bulletHits(world: World, bullet: Bullet, target: AnyEntity): void {
  switch (target.kind) {
    case 'asteroid':
      world.despawn(bullet.id);
      world.emit({ type: 'hit', target: 'asteroid', x: bullet.pos.x, y: bullet.pos.y });
      if (target.takeDamage(bullet.damage))
        destroyAsteroid(world, target, bullet.ownerId);
      return;
    case 'ship':
      if (target.netId === bullet.ownerId) return; // свій корабель
      world.despawn(bullet.id);
      world.emit({
        type: 'hit',
        target: 'ship',
        x: bullet.pos.x,
        y: bullet.pos.y,
        ship: target.netId,
      });
      if (target.takeDamage(bullet.damage * 10))
        destroyShip(world, target, bullet.ownerId);
      return;
    case 'bullet':
    case 'pickup':
      return; // кулі не б'ються одна об одну і не підбирають бонуси
    default:
      assertNever(target);
  }
}

function shipTouches(world: World, ship: Ship, thing: AnyEntity): void {
  switch (thing.kind) {
    case 'asteroid':
      world.emit({
        type: 'hit',
        target: 'ship',
        x: ship.pos.x,
        y: ship.pos.y,
        ship: ship.netId,
      });
      destroyAsteroid(world, thing, null);
      if (ship.takeDamage(thing.size === 2 ? 40 : 20)) destroyShip(world, ship, null);
      return;
    case 'pickup':
      ship.applyPickup(thing.pickup);
      world.despawn(thing.id);
      world.emit({
        type: 'pickup',
        effect: thing.pickup.effect,
        ship: ship.netId,
        x: thing.pos.x,
        y: thing.pos.y,
      });
      return;
    case 'ship':
    case 'bullet':
      return; // кораблі один об одного не б'ються; куля + корабель - у bulletHits
    default:
      assertNever(thing);
  }
}

export function handleCollision(world: World, a: AnyEntity, b: AnyEntity): void {
  if (!a.alive || !b.alive || !a.solid || !b.solid) return;

  // TypeScript звужує тип у кожній гілці: тут a вже Bullet, а не будь-яка сутність
  if (a.kind === 'bullet') return bulletHits(world, a, b);
  if (b.kind === 'bullet') return bulletHits(world, b, a);
  if (a.kind === 'ship') return shipTouches(world, a, b);
  if (b.kind === 'ship') return shipTouches(world, b, a);
}
