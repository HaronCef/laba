import type { EntityId } from 'shared/types.ts';

// Що малювати: прості об'єкти в координатах арени. Union за полем kind,
// тож drawWorld у switch точно знає, які поля є в кожного виду.
interface Placed {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export type Drawable =
  | (Placed & {
      readonly kind: 'ship';
      readonly id: EntityId;
      readonly mine: boolean;
      readonly dead: boolean;
      readonly thrust: boolean;
      readonly shield: boolean;
    })
  | (Placed & { readonly kind: 'bullet'; readonly missile: boolean })
  | (Placed & {
      readonly kind: 'asteroid';
      readonly id: EntityId;
      readonly big: boolean;
      readonly hunter: boolean;
    })
  | (Placed & { readonly kind: 'pickup'; readonly effect: 'shield' | 'triple' });
