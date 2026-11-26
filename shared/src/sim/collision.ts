import type { AnyEntity, World } from './world.ts';

export type Pair = readonly [AnyEntity, AnyEntity];

// Зіткнення коло-коло, повертає пари [a, b].
// Порядок пар завжди однаковий, інакше зламається детермінізм (rng у правилах).
export function findCollisions(world: World): Pair[] {
  return findPairsHashed(solidList(world));
}

export function solidList(world: World): AnyEntity[] {
  const list: AnyEntity[] = [];
  for (const entity of world) {
    if (entity.alive && entity.solid) list.push(entity);
  }
  return list;
}

// просто дотик - ще не зіткнення
export function overlaps(a: AnyEntity, b: AnyEntity): boolean {
  const dx = a.pos.x - b.pos.x;
  const dy = a.pos.y - b.pos.y;
  const r = a.radius + b.radius;
  return dx * dx + dy * dy < r * r; // без sqrt
}

// Старий варіант: кожен з кожним, O(n^2). Лишив для тестів.
export function findPairsNaive(list: readonly AnyEntity[]): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b && overlaps(a, b)) pairs.push([a, b]);
    }
  }
  return pairs;
}

export const CELL_SIZE = 64; // більше за діаметр великого астероїда (60)

// Spatial hash: ділимо арену на клітинки і перевіряємо лише тих, хто в одній клітинці.
export function findPairsHashed(list: readonly AnyEntity[], cellSize = CELL_SIZE): Pair[] {
  const cells = new Map<number, number[]>(); // клітинка -> номери сутностей
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e) continue;
    const x0 = Math.floor((e.pos.x - e.radius) / cellSize);
    const x1 = Math.floor((e.pos.x + e.radius) / cellSize);
    const y0 = Math.floor((e.pos.y - e.radius) / cellSize);
    const y1 = Math.floor((e.pos.y + e.radius) / cellSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = (cx + 1000) * 4096 + (cy + 1000); // +1000, бо бувають мінусові
        const cell = cells.get(key);
        if (cell) cell.push(i);
        else cells.set(key, [i]);
      }
    }
  }

  // пара може бути в кількох клітинках, тому запам'ятовуємо перевірені
  const seen = new Set<number>();
  const found: number[] = []; // пари як i * n + j
  const n = list.length;
  for (const cell of cells.values()) {
    for (let p = 0; p < cell.length; p++) {
      for (let q = p + 1; q < cell.length; q++) {
        const i = cell[p] ?? 0;
        const j = cell[q] ?? 0; // тут завжди i < j
        const key = i * n + j;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = list[i];
        const b = list[j];
        if (a && b && overlaps(a, b)) found.push(key);
      }
    }
  }

  // сортуємо, щоб порядок був як у старого варіанту
  found.sort((x, y) => x - y);
  const pairs: Pair[] = [];
  for (const key of found) {
    const a = list[Math.floor(key / n)];
    const b = list[key % n];
    if (a && b) pairs.push([a, b]);
  }
  return pairs;
}
