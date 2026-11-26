import { BINARY_VERSION, MSG_INPUT, MSG_SNAPSHOT } from '../protocol.js';
import { normalizeAngle } from '../sim/vector.js';

/*
  Бінарний формат v1. УСІ числа little-endian (true в DataView).

  INPUT, 8 байт:
    0  Uint8   версія (1)
    1  Uint8   тип (1 = input)
    2  Uint32  seq
    6  Int8    turn: -1, 0, 1
    7  Uint8   кнопки: біт0 thrust, біт1 fire, біт2 missile, біт3 flip

  SNAPSHOT, 12 байт заголовок + 26 байт на сутність:
    0  Uint8   версія (1)
    1  Uint8   тип (2 = snapshot)
    2  Uint32  tick сервера
    6  Uint32  lastProcessedSeq - останній input цього клієнта, який сервер уже застосував
    10 Uint16  кількість сутностей
    далі для кожної сутності:
    +0  Uint16  id (netId)
    +2  Uint8   kind: 1 ship, 2 bullet, 3 asteroid, 4 pickup
    +3  Uint8   flags (біти FLAG з protocol.js)
    +4  Uint16  owner: корабель - shotCd | missileCd << 8; куля - netId власника
    +6  Float32 x
    +10 Float32 y
    +14 Float32 vx
    +18 Float32 vy
    +22 Int16   angle у тисячних радіана (-3142..3142), точність 0.001 рад
    +24 Uint16  extra: корабель - hp; куля - shotId; астероїд - hp
*/

const LE = true;
const INPUT_BYTES = 8;
const HEADER_BYTES = 12;
const ENTITY_BYTES = 26;

const BTN_THRUST = 1;
const BTN_FIRE = 2;
const BTN_MISSILE = 4;
const BTN_FLIP = 8;

// ws на сервері дає Buffer (це Uint8Array з довільним зсувом), браузер - ArrayBuffer
function viewOf(data) {
  if (data instanceof ArrayBuffer) return new DataView(data);
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function checkHeader(view, type, minBytes) {
  if (view.byteLength < minBytes) throw new Error('too short');
  if (view.getUint8(0) !== BINARY_VERSION) throw new Error(`version ${view.getUint8(0)}`);
  if (view.getUint8(1) !== type) throw new Error(`type ${view.getUint8(1)}`);
}

export function encodeInput(input) {
  const buffer = new ArrayBuffer(INPUT_BYTES);
  const view = new DataView(buffer);
  let buttons = 0;
  if (input.thrust) buttons |= BTN_THRUST;
  if (input.fire) buttons |= BTN_FIRE;
  if (input.missile) buttons |= BTN_MISSILE;
  if (input.flip) buttons |= BTN_FLIP;

  view.setUint8(0, BINARY_VERSION);
  view.setUint8(1, MSG_INPUT);
  view.setUint32(2, input.seq, LE);
  view.setInt8(6, input.turn);
  view.setUint8(7, buttons);
  return buffer;
}

export function decodeInput(data) {
  const view = viewOf(data);
  checkHeader(view, MSG_INPUT, INPUT_BYTES);
  const buttons = view.getUint8(7);
  return {
    seq: view.getUint32(2, LE),
    turn: view.getInt8(6), // сервер ще перевірить, що це -1, 0 або 1
    thrust: (buttons & BTN_THRUST) !== 0,
    fire: (buttons & BTN_FIRE) !== 0,
    missile: (buttons & BTN_MISSILE) !== 0,
    flip: (buttons & BTN_FLIP) !== 0,
  };
}

export function encodeSnapshot({ tick, ack, entities }) {
  const buffer = new ArrayBuffer(HEADER_BYTES + entities.length * ENTITY_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, BINARY_VERSION);
  view.setUint8(1, MSG_SNAPSHOT);
  view.setUint32(2, tick, LE);
  view.setUint32(6, ack, LE);
  view.setUint16(10, entities.length, LE);

  let o = HEADER_BYTES;
  for (const e of entities) {
    view.setUint16(o, e.id, LE);
    view.setUint8(o + 2, e.kind);
    view.setUint8(o + 3, e.flags);
    view.setUint16(o + 4, e.owner, LE);
    view.setFloat32(o + 6, e.x, LE);
    view.setFloat32(o + 10, e.y, LE);
    view.setFloat32(o + 14, e.vx, LE);
    view.setFloat32(o + 18, e.vy, LE);
    view.setInt16(o + 22, Math.round(normalizeAngle(e.angle) * 1000), LE);
    view.setUint16(o + 24, e.extra, LE);
    o += ENTITY_BYTES;
  }
  return buffer;
}

// Знімок однаковий для всіх, крім lastProcessedSeq. Тому сервер кодує його один раз,
// а кожному клієнту робить копію і міняє лише ці 4 байти.
export function withAck(snapshotBuffer, ack) {
  const copy = snapshotBuffer.slice(0);
  new DataView(copy).setUint32(6, ack, LE);
  return copy;
}

export function decodeSnapshot(data) {
  const view = viewOf(data);
  checkHeader(view, MSG_SNAPSHOT, HEADER_BYTES);
  const count = view.getUint16(10, LE);
  if (view.byteLength !== HEADER_BYTES + count * ENTITY_BYTES)
    throw new Error('bad length');

  const entities = [];
  let o = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    entities.push({
      id: view.getUint16(o, LE),
      kind: view.getUint8(o + 2),
      flags: view.getUint8(o + 3),
      owner: view.getUint16(o + 4, LE),
      x: view.getFloat32(o + 6, LE),
      y: view.getFloat32(o + 10, LE),
      vx: view.getFloat32(o + 14, LE),
      vy: view.getFloat32(o + 18, LE),
      angle: view.getInt16(o + 22, LE) / 1000,
      extra: view.getUint16(o + 24, LE),
    });
    o += ENTITY_BYTES;
  }
  return { tick: view.getUint32(2, LE), ack: view.getUint32(6, LE), entities };
}

export function isBinarySnapshot(data) {
  return viewOf(data).getUint8(1) === MSG_SNAPSHOT;
}
