// Система зіткнень коло-коло. Наївно, кожен з кожним: O(n^2).
// Нічого не знає про кулі чи астероїди - лише повертає пари [a, b],
// тому потім її легко замінити на spatial hash (лаба 7).

export function findCollisions(world) {
  const list = [];
  for (const entity of world) {
    if (entity.alive && entity.solid) list.push(entity);
  }

  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.pos.distanceTo(b.pos) < a.radius + b.radius) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}
