import { Entity } from './entity.js';

// Бонус: стоїть на місці, з ним можна зіткнутись, але це не корабель.
// Що саме він робить - описано даними в полі pickup (компонент),
// а не окремим класом ShieldPickup / TriplePickup.
export class Pickup extends Entity {
  constructor({ pos, effect }) {
    super({ pos, radius: 12, kind: 'pickup' });
    this.pickup = { effect, duration: effect === 'shield' ? 5 : 8 };
    this.ttl = 12; // якщо ніхто не підібрав - зникає
  }

  update(dt, world) {
    this.ttl -= dt;
    if (this.ttl <= 0) {
      world.despawn(this.id);
    }
  }
}
