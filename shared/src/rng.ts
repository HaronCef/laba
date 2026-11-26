// Генератор псевдовипадкових чисел mulberry32.
// Той самий seed дає ту саму послідовність у Node і в браузері,
// тому замість Math.random() симуляція бере числа звідси.
export type Rng = () => number; // число в [0, 1)

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
