import { Vector2 } from './vector.js';

// Арена: розміри і "загортання" країв (вилетів справа - з'явився зліва)

export function createArena(width, height) {
  return { width, height };
}

// повертає value в межах [0, max), працює і для від'ємних чисел
export function wrapValue(value, max) {
  return ((value % max) + max) % max;
}

export function wrapPosition(pos, arena) {
  return new Vector2(wrapValue(pos.x, arena.width), wrapValue(pos.y, arena.height));
}
