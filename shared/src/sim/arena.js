import { Vector2 } from './vector.js';

// Арена тепер однакова для всіх гравців (раніше дорівнювала розміру вікна).
// Клієнт масштабує її під своє вікно.
export const ARENA = { width: 1280, height: 720 };

// повертає value в межах [0, max), працює і для від'ємних чисел
export function wrapValue(value, max) {
  return ((value % max) + max) % max;
}

export function wrapPosition(pos, arena) {
  return new Vector2(wrapValue(pos.x, arena.width), wrapValue(pos.y, arena.height));
}
