// Спільні константи протоколу гри (лаба 5). Їх імпортують і сервер, і клієнт.
//
// Що ходить по мережі:
//   клієнт -> сервер: input (кожен крок, 30/с), а також JSON з лаби 4: join, chat, leave, ping, netsim
//   сервер -> клієнт: snapshot (кожен крок), а також JSON: joined, roster, chat, events, pong, error
// input і snapshot - бінарні (DataView), або JSON, якщо клієнт підключився з ?codec=json.

export const BINARY_VERSION = 1;
export const MSG_INPUT = 1;
export const MSG_SNAPSHOT = 2;

export const KIND = { ship: 1, bullet: 2, asteroid: 3, pickup: 4 };
export const KIND_NAME = { 1: 'ship', 2: 'bullet', 3: 'asteroid', 4: 'pickup' };

// біти поля flags у знімку
export const FLAG = {
  THRUST: 1, // корабель: газує
  SHIELD: 2, // корабель: щит
  TRIPLE: 4, // корабель: потрійний постріл
  DEAD: 8, // корабель: знищений, чекає респауну
  MISSILE: 16, // куля: самонавідна ракета
  BIG: 32, // астероїд: великий
  HUNTER: 64, // астероїд: мисливець
  EFFECT_TRIPLE: 128, // бонус: потрійний постріл (інакше щит)
};

// Перевірка input на сервері. Сервер не вірить клієнту:
// turn = 1000 або seq = -5 - це чит або зламаний клієнт.
export function isValidInput(input) {
  return (
    input !== null &&
    typeof input === 'object' &&
    Number.isInteger(input.seq) &&
    input.seq >= 0 &&
    input.seq <= 0xffffffff &&
    (input.turn === -1 || input.turn === 0 || input.turn === 1) &&
    typeof input.thrust === 'boolean' &&
    typeof input.fire === 'boolean' &&
    typeof input.missile === 'boolean' &&
    typeof input.flip === 'boolean'
  );
}

// Сутність світу -> плоский запис для знімка (однаковий для JSON і бінарного формату).
// Поля owner і extra означають різне для різних видів (див. codec/binary.js).
export function entityToRecord(e) {
  const record = {
    id: e.netId,
    kind: KIND[e.kind],
    flags: 0,
    owner: 0,
    x: e.pos.x,
    y: e.pos.y,
    vx: e.vel.x,
    vy: e.vel.y,
    angle: e.angle,
    extra: 0,
  };
  if (e.kind === 'ship') {
    if (e.thrust) record.flags |= FLAG.THRUST;
    if (e.effects.shield > 0) record.flags |= FLAG.SHIELD;
    if (e.effects.triple > 0) record.flags |= FLAG.TRIPLE;
    if (e.isDead) record.flags |= FLAG.DEAD;
    record.owner = e.shotCd | (e.missileCd << 8); // кулдауни потрібні клієнту для прогнозу
    record.extra = e.hp;
  } else if (e.kind === 'bullet') {
    if (e.homing) record.flags |= FLAG.MISSILE;
    record.owner = e.ownerId;
    record.extra = e.shotId;
  } else if (e.kind === 'asteroid') {
    if (e.size === 2) record.flags |= FLAG.BIG;
    if (e.homing) record.flags |= FLAG.HUNTER;
    record.extra = Math.max(0, e.hp);
  } else if (e.kind === 'pickup') {
    if (e.pickup.effect === 'triple') record.flags |= FLAG.EFFECT_TRIPLE;
  }
  return record;
}
