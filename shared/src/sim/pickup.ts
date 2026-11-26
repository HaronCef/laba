import { Entity } from './entity.ts';
import type { Vector2 } from './vector.ts';
import type { World } from './world.ts';

export type PickupEffect = 'shield' | 'triple';

// Бонус: стоїть на місці, з ним можна зіткнутись, але це не корабель.
// Що саме він робить - описано даними в полі pickup (компонент).
export class Pickup extends Entity {
  readonly kind = 'pickup';
  readonly pickup: { readonly effect: PickupEffect; readonly duration: number };
  ttl = 12; // якщо ніхто не підібрав - зникає

  constructor({ pos, effect }: { pos: Vector2; effect: PickupEffect }) {
    super({ pos, radius: 12 });
    this.pickup = { effect, duration: effect === 'shield' ? 5 : 8 };
  }

  override update(dt: number, world: World): void {
    this.ttl -= dt;
    if (this.ttl <= 0) {
      world.despawn(this.id);
    }
  }
}
