import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  withAck,
} from '../src/codec/binary.js';
import { FLAG, KIND } from '../src/protocol.js';

test('input: decode(encode(x)) == x', () => {
  const inputs = [
    { seq: 0, turn: 0, thrust: false, fire: false, missile: false, flip: false },
    { seq: 123456, turn: -1, thrust: true, fire: true, missile: false, flip: true },
    { seq: 0xffffffff, turn: 1, thrust: false, fire: false, missile: true, flip: false },
  ];
  for (const input of inputs) {
    assert.equal(encodeInput(input).byteLength, 8);
    assert.deepEqual(decodeInput(encodeInput(input)), input);
  }
});

test('snapshot: round-trip у межах квантування', () => {
  const msg = {
    tick: 987654,
    ack: 4321,
    entities: [
      {
        id: 1,
        kind: KIND.ship,
        flags: FLAG.THRUST | FLAG.SHIELD,
        owner: 3 | (40 << 8),
        x: 640.25,
        y: 10.5,
        vx: -120.75,
        vy: 33.125,
        angle: 3.14159,
        extra: 100,
      },
      {
        id: 65535,
        kind: KIND.bullet,
        flags: FLAG.MISSILE,
        owner: 1,
        x: 0,
        y: 719.99,
        vx: 520,
        vy: -1,
        angle: -2.5,
        extra: 65535,
      },
      {
        id: 7,
        kind: KIND.asteroid,
        flags: FLAG.BIG | FLAG.HUNTER,
        owner: 0,
        x: 1279.9,
        y: 0.1,
        vx: 1,
        vy: 2,
        angle: 0,
        extra: 3,
      },
    ],
  };
  const bytes = encodeSnapshot(msg);
  assert.equal(bytes.byteLength, 12 + 3 * 26);
  const back = decodeSnapshot(bytes);
  assert.equal(back.tick, msg.tick);
  assert.equal(back.ack, msg.ack);
  back.entities.forEach((e, i) => {
    const orig = msg.entities[i];
    for (const key of ['id', 'kind', 'flags', 'owner', 'extra'])
      assert.equal(e[key], orig[key]);
    for (const key of ['x', 'y', 'vx', 'vy'])
      assert.ok(Math.abs(e[key] - orig[key]) < 1e-3, key);
    assert.ok(Math.abs(e.angle - orig.angle) <= 0.0005 + 1e-9, 'angle');
  });
  assert.equal(decodeSnapshot(withAck(bytes, 99)).ack, 99);
});

test('чужа версія або обрізаний пакет -> помилка', () => {
  const bytes = new Uint8Array(
    encodeInput({
      seq: 1,
      turn: 0,
      thrust: false,
      fire: false,
      missile: false,
      flip: false,
    }),
  );
  bytes[0] = 7;
  assert.throws(() => decodeInput(bytes), /version/);
  assert.throws(() => decodeInput(new Uint8Array([1, 1, 0])), /too short/);
});

test('Node Buffer з ненульовим зсувом теж читається (так дає ws)', () => {
  const input = {
    seq: 77,
    turn: 1,
    thrust: true,
    fire: false,
    missile: false,
    flip: false,
  };
  const big = Buffer.alloc(20);
  Buffer.from(encodeInput(input)).copy(big, 5);
  assert.deepEqual(decodeInput(big.subarray(5, 13)), input);
});
