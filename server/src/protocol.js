import { isValidInput } from 'shared/protocol.js';
import { isValidNetsim } from './netsim.js';

// Текстовий протокол v0. Кожне повідомлення - JSON з полями v (версія) і type.
// (input і snapshot за замовчуванням бінарні - див. shared/src/codec/binary.js)
//
// клієнт -> сервер:
//   { v: 0, type: 'join', room, name, codec?: 'binary'|'json', net?: { lag, jitter, drop } }
//   { v: 0, type: 'chat', text }
//   { v: 0, type: 'leave' }
//   { v: 0, type: 'input', seq, turn, thrust, fire, missile, flip }  - лише з codec 'json'
//   { v: 0, type: 'ping', t }                 - для RTT
//   { v: 0, type: 'netsim', lag, jitter, drop } - змінити штучну затримку на льоту
// сервер -> клієнт:
//   { v: 0, type: 'joined', room, you, shipId, seed, tick }
//   { v: 0, type: 'roster', players: [{ id, name, shipId }] }
//   { v: 0, type: 'chat', from, text, t }
//   { v: 0, type: 'events', tick, list }      - постріли, вибухи, очки (для звуку й ефектів)
//   { v: 0, type: 'pong', t }
//   { v: 0, type: 'snapshot', ... }           - лише з codec 'json'
//   { v: 0, type: 'error', code, message }    - перед закриттям сокета

export const VERSION = 0;
export const MAX_MESSAGE_BYTES = 2048; // maxPayload для ws
export const MAX_CHAT_LENGTH = 200;
export const MAX_NAME_LENGTH = 16;

// коди закриття (4000-4999 - коди для свого застосунку)
export const CLOSE = {
  NORMAL: 1000,
  SHUTDOWN: 1001, // сервер вимикається
  TOO_BIG: 1009, // ставить сама бібліотека ws, якщо більше maxPayload
  BAD_MESSAGE: 4000, // не JSON або неправильна форма
  UNKNOWN_TYPE: 4001,
  BAD_VERSION: 4002,
  JOIN_TIMEOUT: 4003, // не надіслав join за 5 с
  RATE_LIMIT: 4004, // забагато повідомлень за секунду
  ROOM_UNAVAILABLE: 4005, // кімнати немає або вона повна
  SLOW_CLIENT: 4006, // не встигає приймати
  NO_HEARTBEAT: 4007, // не відповідав на ping
};

const ROOM_ID = /^[a-z0-9-]{1,32}$/;

function isString(value, min, max) {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max;
}

// що має бути в кожному типі повідомлення
const shapes = {
  join: (m) =>
    isString(m.room, 1, 32) &&
    ROOM_ID.test(m.room) &&
    isString(m.name, 1, MAX_NAME_LENGTH) &&
    (m.codec === undefined || m.codec === 'binary' || m.codec === 'json') &&
    (m.net === undefined || isValidNetsim(m.net)),
  chat: (m) => isString(m.text, 1, MAX_CHAT_LENGTH),
  leave: () => true,
  input: (m) => isValidInput(m),
  ping: (m) => Number.isFinite(m.t),
  netsim: (m) => isValidNetsim(m),
};

// Повертає { ok: true, msg } або { ok: false, code, reason }
export function validate(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { ok: false, code: CLOSE.BAD_MESSAGE, reason: 'not JSON' };
  }
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return { ok: false, code: CLOSE.BAD_MESSAGE, reason: 'not an object' };
  }
  if (msg.v !== VERSION) {
    return { ok: false, code: CLOSE.BAD_VERSION, reason: `version ${msg.v}` };
  }
  // hasOwn, а не просто shapes[type]: інакше type "constructor" знайде метод Object
  const check = Object.hasOwn(shapes, msg.type) ? shapes[msg.type] : null;
  if (!check) {
    return { ok: false, code: CLOSE.UNKNOWN_TYPE, reason: `unknown type ${msg.type}` };
  }
  if (!check(msg)) {
    return { ok: false, code: CLOSE.BAD_MESSAGE, reason: `bad ${msg.type}` };
  }
  return { ok: true, msg };
}

export function make(type, fields = {}) {
  return JSON.stringify({ v: VERSION, type, ...fields });
}
