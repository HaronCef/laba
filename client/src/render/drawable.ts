import { asEntityId, type EntityId } from 'shared/types.ts';

export type DrawKind = 'ship' | 'bullet' | 'asteroid' | 'pickup';

// Що малювати. Один клас з усіма полями, щоб у V8 була одна форма об'єкта
// (раніше було кілька різних об'єктів і доступ e.x ставав megamorphic).
export class Drawable {
  kind: DrawKind = 'bullet';
  x = 0;
  y = 0;
  angle = 0;
  id: EntityId = asEntityId(0);
  mine = false; // ship
  dead = false; // ship
  thrust = false; // ship
  shield = false; // ship
  missile = false; // bullet
  big = false; // asteroid
  hunter = false; // asteroid
  effect: 'shield' | 'triple' = 'shield'; // pickup
}

// Пул: кожен кадр беремо ті самі об'єкти заново, нових не створюємо.
export class DrawablePool {
  readonly #items: Drawable[] = [];
  readonly list: Drawable[] = []; // те, що малюємо в цьому кадрі
  #used = 0;

  reset(): void {
    this.#used = 0;
    this.list.length = 0;
  }

  take(kind: DrawKind, x: number, y: number, angle: number): Drawable {
    let d = this.#items[this.#used];
    if (!d) {
      d = new Drawable();
      this.#items.push(d);
    }
    this.#used++;
    d.kind = kind;
    d.x = x;
    d.y = y;
    d.angle = angle;
    d.mine = d.dead = d.thrust = d.shield = d.missile = d.big = d.hunter = false;
    this.list.push(d);
    return d;
  }

  get size(): number {
    return this.#items.length;
  }
}
