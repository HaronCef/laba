import { Vector2 } from './vector.ts';

export interface Arena {
  readonly width: number;
  readonly height: number;
}

// Арена однакова для всіх гравців. Клієнт масштабує її під своє вікно.
export const ARENA: Arena = { width: 1280, height: 720 };

// повертає value в межах [0, max), працює і для від'ємних чисел
export function wrapValue(value: number, max: number): number {
  return ((value % max) + max) % max;
}

export function wrapPosition(pos: Vector2, arena: Arena): Vector2 {
  return new Vector2(wrapValue(pos.x, arena.width), wrapValue(pos.y, arena.height));
}
