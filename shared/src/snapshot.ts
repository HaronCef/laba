import { assertNever } from './types.ts';
import type { EntityRecord } from './protocol.ts';
import type { AnyEntity } from './sim/world.ts';

// Сутність світу -> запис для знімка. switch по kind з never у default:
// якщо колись з'явиться новий вид сутності, tsc не дасть забути його тут.
export function entityToRecord(e: AnyEntity): EntityRecord {
  const base = { id: e.netId, x: e.pos.x, y: e.pos.y, vx: e.vel.x, vy: e.vel.y, angle: e.angle };
  switch (e.kind) {
    case 'ship':
      return {
        kind: 'ship',
        ...base,
        thrust: e.thrust,
        shield: e.effects.shield > 0,
        triple: e.effects.triple > 0,
        dead: e.isDead,
        shotCd: e.shotCd,
        missileCd: e.missileCd,
        hp: e.hp,
      };
    case 'bullet':
      return { kind: 'bullet', ...base, missile: e.homing !== null, owner: e.ownerId, shotId: e.shotId };
    case 'asteroid':
      return { kind: 'asteroid', ...base, big: e.size === 2, hunter: e.homing !== null, hp: Math.max(0, e.hp) };
    case 'pickup':
      return { kind: 'pickup', ...base, effect: e.pickup.effect };
    default:
      return assertNever(e);
  }
}
