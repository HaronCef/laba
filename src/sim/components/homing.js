import { normalizeAngle } from '../vector.js';

// Компонент самонаведення. Це просто дані, які можна "причепити" до будь-якої
// сутності: entity.homing = makeHoming(...). Самі дані нічого не роблять -
// працює функція homingSystem, яка шукає всі сутності з полем homing.

export function makeHoming(targetKind, turnRate, range) {
  return { targetKind, turnRate, range };
}

function findNearest(world, entity, kind, range) {
  let best = null;
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
export function homingSystem(world, dt) {
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
