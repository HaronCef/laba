import { normalizeAngle } from '../vector.ts';
import type { EntityKind } from '../../protocol.ts';
import type { AnyEntity, World } from '../world.ts';

// Компонент самонаведення. Це просто дані, які можна "причепити" до будь-якої
// сутності: entity.homing = makeHoming(...). Працює функція homingSystem,
// яка шукає всі сутності з полем homing.
export interface Homing {
  readonly targetKind: EntityKind;
  readonly turnRate: number; // рад/с
  readonly range: number; // px
}

export function makeHoming(
  targetKind: EntityKind,
  turnRate: number,
  range: number,
): Homing {
  return { targetKind, turnRate, range };
}

function findNearest(
  world: World,
  entity: AnyEntity,
  kind: EntityKind,
  range: number,
): AnyEntity | null {
  let best: AnyEntity | null = null;
  let bestDist = range;
  for (const other of world.ofKind(kind)) {
    if (other === entity || !other.solid) continue;
    const d = entity.pos.distanceTo(other.pos);
    if (d < bestDist) {
      bestDist = d;
      best = other;
    }
  }
  return best;
}

// повертає швидкість у бік найближчої цілі, але не швидше ніж turnRate рад/с
export function homingSystem(world: World, dt: number): void {
  for (const entity of world) {
    if (!entity.homing || !entity.alive) continue;

    const { targetKind, turnRate, range } = entity.homing;
    const target = findNearest(world, entity, targetKind, range);
    if (!target) continue;

    const wanted = target.pos.sub(entity.pos).angle();
    const current = entity.vel.angle();
    const diff = normalizeAngle(wanted - current);
    const maxTurn = turnRate * dt;
    const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));

    entity.vel = entity.vel.rotate(turn);
    entity.angle = entity.vel.angle();
  }
}
