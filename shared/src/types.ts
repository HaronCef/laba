// Загальні типи для всіх пакетів.

// ---------- branded-типи ----------
// Для JS усі три - просто числа. Але номер сутності, номер кроку і seq input
// не можна плутати, тому для TypeScript вони різні: до number "приклеєна" мітка,
// якої в рантаймі не існує. Передати Tick туди, де чекають Seq, - помилка tsc.

declare const brandTag: unique symbol;
export type Brand<T, Name extends string> = T & { readonly [brandTag]: Name };

export type EntityId = Brand<number, 'EntityId'>; // netId сутності (Uint16)
export type Tick = Brand<number, 'Tick'>; // номер кроку сервера
export type Seq = Brand<number, 'Seq'>; // номер input клієнта
export type PlayerId = Brand<number, 'PlayerId'>; // номер з'єднання на сервері

// Єдине місце, де звичайне число стає branded. Перевіряє число той, хто викликає
// (Zod-схема, бінарний декодер), тут лише міняється тип.
function brand<B extends Brand<number, string>>(n: number): B {
  return n as B; // as №1: мітка існує лише в типах, у рантаймі це те саме число
}

export const asEntityId = (n: number): EntityId => brand<EntityId>(n);
export const asTick = (n: number): Tick => brand<Tick>(n);
export const asSeq = (n: number): Seq => brand<Seq>(n);
export const asPlayerId = (n: number): PlayerId => brand<PlayerId>(n);

// ---------- результат без винятків ----------

export type Result<T, E = string> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function fail<E>(error: E): { readonly ok: false; readonly error: E } {
  return { ok: false, error };
}

// ---------- вичерпний switch ----------
// У default кожного switch по type/kind пишемо assertNever(x).
// Якщо додати новий варіант і забути case, x у default уже не never - tsc покаже помилку.
export function assertNever(value: never): never {
  throw new Error(`не оброблено: ${JSON.stringify(value)}`);
}
