import type { AnyEntity, World } from './world.ts';

// Система зіткнень коло-коло. Наївно, кожен з кожним: O(n^2).
// Нічого не знає про кулі чи астероїди - лише повертає пари [a, b].
export function findCollisions(world: World): Array<readonly [AnyEntity, AnyEntity]> {
  const list: AnyEntity[] = [];
  for (const entity of world) {
    if (entity.alive && entity.solid) list.push(entity);
  }

  const pairs: Array<readonly [AnyEntity, AnyEntity]> = [];
  list.forEach((a, i) => {
    for (const b of list.slice(i + 1)) {
      if (a.pos.distanceTo(b.pos) < a.radius + b.radius) {
        pairs.push([a, b]);
      }
    }
  });
  return pairs;
}
