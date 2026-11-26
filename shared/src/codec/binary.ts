import { normalizeAngle } from '../sim/vector.ts';
import {
  asEntityId,
  asSeq,
  asTick,
  assertNever,
  fail,
  ok,
  type Result,
} from '../types.ts';
import type { EntityRecord, Input, Snapshot } from '../protocol.ts';

/*
  Бінарний формат v1. УСІ числа little-endian (true в DataView).

  INPUT, 8 байт:
    0  Uint8   версія (1)
    1  Uint8   тип (1 = input)
    2  Uint32  seq
    6  Int8    turn: -1, 0, 1
    7  Uint8   кнопки: біт0 thrust, біт1 fire, біт2 missile, біт3 flip (інші біти мають бути 0)

  SNAPSHOT, 12 байт заголовок + 26 байт на сутність:
    0  Uint8   версія (1)
    1  Uint8   тип (2 = snapshot)
    2  Uint32  tick сервера
    6  Uint32  lastProcessedSeq - останній input цього клієнта, який сервер уже застосував
    10 Uint16  кількість сутностей
    далі для кожної сутності:
    +0  Uint16  id
    +2  Uint8   kind: 1 ship, 2 bullet, 3 asteroid, 4 pickup
    +3  Uint8   flags (біти нижче, свої для кожного kind)
    +4  Uint16  owner: корабель - shotCd | missileCd << 8; куля - id власника; інші - 0
    +6  Float32 x
    +10 Float32 y
    +14 Float32 vx
    +18 Float32 vy
    +22 Int16   angle у тисячних радіана (-3142..3142), точність 0.001 рад
    +24 Uint16  extra: корабель - hp; куля - shotId; астероїд - hp; бонус - 0
*/

export const BINARY_VERSION = 1;
const MSG_INPUT = 1;
const MSG_SNAPSHOT = 2;
const LE = true;
const INPUT_BYTES = 8;
const HEADER_BYTES = 12;
const ENTITY_BYTES = 26;
const MAX_ANGLE = 3142; // π * 1000, округлено вгору

const KIND_CODE = { ship: 1, bullet: 2, asteroid: 3, pickup: 4 } satisfies Record<
  EntityRecord['kind'],
  number
>;

const BTN = { thrust: 1, fire: 2, missile: 4, flip: 8 };
const F = {
  thrust: 1,
  shield: 2,
  triple: 4,
  dead: 8,
  missile: 1,
  big: 1,
  hunter: 2,
  effectTriple: 1,
};

type Bytes = ArrayBuffer | Uint8Array;

// ws на сервері дає Buffer (Uint8Array з довільним зсувом), браузер - ArrayBuffer
function viewOf(data: Bytes): DataView {
  if (data instanceof ArrayBuffer) return new DataView(data);
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function checkHeader(view: DataView, type: number, minBytes: number): string | null {
  if (view.byteLength < minBytes) return 'too short';
  if (view.getUint8(0) !== BINARY_VERSION) return `version ${view.getUint8(0)}`;
  if (view.getUint8(1) !== type) return `type ${view.getUint8(1)}`;
  return null;
}

// ---------- input ----------

export function encodeInput(input: Input): ArrayBuffer {
  const buffer = new ArrayBuffer(INPUT_BYTES);
  const view = new DataView(buffer);
  let buttons = 0;
  if (input.thrust) buttons |= BTN.thrust;
  if (input.fire) buttons |= BTN.fire;
  if (input.missile) buttons |= BTN.missile;
  if (input.flip) buttons |= BTN.flip;

  view.setUint8(0, BINARY_VERSION);
  view.setUint8(1, MSG_INPUT);
  view.setUint32(2, input.seq, LE);
  view.setInt8(6, input.turn);
  view.setUint8(7, buttons);
  return buffer;
}

// Декодер сам перевіряє все: довжину, версію, тип і діапазони. Винятків не кидає.
export function decodeInput(data: Bytes): Result<Input> {
  const view = viewOf(data);
  const headerError = checkHeader(view, MSG_INPUT, INPUT_BYTES);
  if (headerError) return fail(headerError);
  if (view.byteLength !== INPUT_BYTES) return fail('bad length');

  const turn = view.getInt8(6);
  if (turn !== -1 && turn !== 0 && turn !== 1) return fail(`turn ${turn}`); // тут TypeScript звужує тип до -1 | 0 | 1
  const buttons = view.getUint8(7);
  if (buttons > 0b1111) return fail('unknown buttons');

  return ok({
    seq: asSeq(view.getUint32(2, LE)),
    turn,
    thrust: (buttons & BTN.thrust) !== 0,
    fire: (buttons & BTN.fire) !== 0,
    missile: (buttons & BTN.missile) !== 0,
    flip: (buttons & BTN.flip) !== 0,
  });
}

// ---------- snapshot ----------

// flags, owner і extra для кожного виду свої
function packKindFields(e: EntityRecord): {
  flags: number;
  owner: number;
  extra: number;
} {
  switch (e.kind) {
    case 'ship': {
      let flags = 0;
      if (e.thrust) flags |= F.thrust;
      if (e.shield) flags |= F.shield;
      if (e.triple) flags |= F.triple;
      if (e.dead) flags |= F.dead;
      return { flags, owner: e.shotCd | (e.missileCd << 8), extra: e.hp };
    }
    case 'bullet':
      return { flags: e.missile ? F.missile : 0, owner: e.owner, extra: e.shotId };
    case 'asteroid':
      return {
        flags: (e.big ? F.big : 0) | (e.hunter ? F.hunter : 0),
        owner: 0,
        extra: e.hp,
      };
    case 'pickup':
      return { flags: e.effect === 'triple' ? F.effectTriple : 0, owner: 0, extra: 0 };
    default:
      return assertNever(e);
  }
}

function checkU16(name: string, n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff)
    throw new RangeError(`${name} = ${n} не влазить у Uint16`);
  return n;
}

export function encodeSnapshot(snapshot: Snapshot): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_BYTES + snapshot.entities.length * ENTITY_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, BINARY_VERSION);
  view.setUint8(1, MSG_SNAPSHOT);
  view.setUint32(2, snapshot.tick, LE);
  view.setUint32(6, snapshot.ack, LE);
  view.setUint16(10, checkU16('count', snapshot.entities.length), LE);

  let o = HEADER_BYTES;
  for (const e of snapshot.entities) {
    const { flags, owner, extra } = packKindFields(e);
    view.setUint16(o, checkU16('id', e.id), LE);
    view.setUint8(o + 2, KIND_CODE[e.kind]);
    view.setUint8(o + 3, flags);
    view.setUint16(o + 4, checkU16('owner', owner), LE);
    view.setFloat32(o + 6, e.x, LE);
    view.setFloat32(o + 10, e.y, LE);
    view.setFloat32(o + 14, e.vx, LE);
    view.setFloat32(o + 18, e.vy, LE);
    view.setInt16(o + 22, Math.round(normalizeAngle(e.angle) * 1000), LE);
    view.setUint16(o + 24, checkU16('extra', extra), LE);
    o += ENTITY_BYTES;
  }
  return buffer;
}

function readEntity(view: DataView, o: number): Result<EntityRecord> {
  const angleMilli = view.getInt16(o + 22, LE);
  if (angleMilli < -MAX_ANGLE || angleMilli > MAX_ANGLE)
    return fail(`angle ${angleMilli}`);
  const base = {
    id: asEntityId(view.getUint16(o, LE)),
    x: view.getFloat32(o + 6, LE),
    y: view.getFloat32(o + 10, LE),
    vx: view.getFloat32(o + 14, LE),
    vy: view.getFloat32(o + 18, LE),
    angle: angleMilli / 1000,
  };
  if (![base.x, base.y, base.vx, base.vy].every(Number.isFinite))
    return fail('NaN or Infinity');

  const kind = view.getUint8(o + 2);
  const flags = view.getUint8(o + 3);
  const owner = view.getUint16(o + 4, LE);
  const extra = view.getUint16(o + 24, LE);

  switch (kind) {
    case KIND_CODE.ship:
      if (flags > 0b1111) return fail('ship flags');
      return ok({
        kind: 'ship',
        ...base,
        thrust: (flags & F.thrust) !== 0,
        shield: (flags & F.shield) !== 0,
        triple: (flags & F.triple) !== 0,
        dead: (flags & F.dead) !== 0,
        shotCd: owner & 0xff,
        missileCd: owner >> 8,
        hp: extra,
      });
    case KIND_CODE.bullet:
      if (flags > 1) return fail('bullet flags');
      return ok({
        kind: 'bullet',
        ...base,
        missile: flags === 1,
        owner: asEntityId(owner),
        shotId: extra,
      });
    case KIND_CODE.asteroid:
      if (flags > 0b11) return fail('asteroid flags');
      return ok({
        kind: 'asteroid',
        ...base,
        big: (flags & F.big) !== 0,
        hunter: (flags & F.hunter) !== 0,
        hp: extra,
      });
    case KIND_CODE.pickup:
      if (flags > 1) return fail('pickup flags');
      return ok({ kind: 'pickup', ...base, effect: flags === 1 ? 'triple' : 'shield' });
    default:
      return fail(`unknown kind ${kind}`);
  }
}

export function decodeSnapshot(data: Bytes): Result<Snapshot> {
  const view = viewOf(data);
  const headerError = checkHeader(view, MSG_SNAPSHOT, HEADER_BYTES);
  if (headerError) return fail(headerError);
  const count = view.getUint16(10, LE);
  if (view.byteLength !== HEADER_BYTES + count * ENTITY_BYTES) return fail('bad length');

  const entities: EntityRecord[] = [];
  for (let i = 0; i < count; i++) {
    const entity = readEntity(view, HEADER_BYTES + i * ENTITY_BYTES);
    if (!entity.ok) return fail(`entity ${i}: ${entity.error}`);
    entities.push(entity.value);
  }
  return ok({
    tick: asTick(view.getUint32(2, LE)),
    ack: asSeq(view.getUint32(6, LE)),
    entities,
  });
}
