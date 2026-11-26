import { stepShip, type ShipState } from 'shared/sim/ship.ts';
import { ARENA } from 'shared/sim/arena.ts';
import type { Input } from 'shared/protocol.ts';
import type { Seq } from 'shared/types.ts';

export const SNAP_DISTANCE = 150; // більша поправка (респаун) - ставимо одразу

// різниця з урахуванням країв арени
export function wrappedDelta(d: number, size: number): number {
  if (d > size / 2) return d - size;
  if (d < -size / 2) return d + size;
  return d;
}

export interface Reconciled {
  readonly state: ShipState; // де корабель має бути зараз
  readonly pending: Input[]; // input, які сервер ще не застосував
  readonly dx: number; // наскільки прогноз помилився
  readonly dy: number;
  readonly correction: number;
  readonly snap: boolean; // поправка завелика, без згладжування
}

// Reconciliation окремою функцією (так легше тестувати): беремо стан сервера,
// викидаємо підтверджені input і програємо решту заново.
export function reconcile(server: ShipState, ack: Seq, pending: readonly Input[], predicted: ShipState): Reconciled {
  const left = pending.filter((input) => input.seq > ack);
  let state = server;
  for (const input of left) state = stepShip(state, input).state;

  const dx = wrappedDelta(state.x - predicted.x, ARENA.width);
  const dy = wrappedDelta(state.y - predicted.y, ARENA.height);
  const correction = Math.hypot(dx, dy);
  return { state, pending: left, dx, dy, correction, snap: correction > SNAP_DISTANCE };
}
