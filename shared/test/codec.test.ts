import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
} from '../src/codec/binary.ts';
import { jsonCodec } from '../src/codec/index.ts';
import { asEntityId, asSeq, asTick } from '../src/types.ts';
import type { Input, Snapshot } from '../src/protocol.ts';

// елемент масиву або помилка тесту (з noUncheckedIndexedAccess arr[i] може бути undefined)
function must<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}

const numberKeys: Array<'x' | 'y' | 'vx' | 'vy'> = ['x', 'y', 'vx', 'vy'];

const inputs: Input[] = [
  { seq: asSeq(0), turn: 0, thrust: false, fire: false, missile: false, flip: false },
  { seq: asSeq(123456), turn: -1, thrust: true, fire: true, missile: false, flip: true },
  {
    seq: asSeq(0xffffffff),
    turn: 1,
    thrust: false,
    fire: false,
    missile: true,
    flip: false,
  },
];

const snapshot: Snapshot = {
  tick: asTick(987654),
  ack: asSeq(4321),
  entities: [
    {
      kind: 'ship',
      id: asEntityId(1),
      x: 640.25,
      y: 10.5,
      vx: -120.75,
      vy: 33.125,
      angle: 3.14159,
      thrust: true,
      shield: true,
      triple: false,
      dead: false,
      shotCd: 3,
      missileCd: 40,
      hp: 100,
    },
    {
      kind: 'bullet',
      id: asEntityId(65535),
      x: 0,
      y: 719.99,
      vx: 520,
      vy: -1,
      angle: -2.5,
      missile: true,
      owner: asEntityId(1),
      shotId: 65535,
    },
    {
      kind: 'asteroid',
      id: asEntityId(7),
      x: 1279.9,
      y: 0.1,
      vx: 1,
      vy: 2,
      angle: 0,
      big: true,
      hunter: true,
      hp: 3,
    },
    {
      kind: 'pickup',
      id: asEntityId(8),
      x: 5,
      y: 6,
      vx: 0,
      vy: 0,
      angle: 0,
      effect: 'triple',
    },
  ],
};

test('input: decode(encode(x)) == x', () => {
  for (const input of inputs) {
    assert.equal(encodeInput(input).byteLength, 8);
    assert.deepEqual(decodeInput(encodeInput(input)), { ok: true, value: input });
  }
});

test('snapshot: round-trip у межах квантування', () => {
  const bytes = encodeSnapshot(snapshot);
  assert.equal(bytes.byteLength, 12 + 4 * 26);
  const back = decodeSnapshot(bytes);
  assert.ok(back.ok);
  assert.equal(back.value.tick, snapshot.tick);
  assert.equal(back.value.ack, snapshot.ack);
  back.value.entities.forEach((e, i) => {
    const orig = must(snapshot.entities[i]);
    assert.equal(e.kind, orig.kind);
    for (const key of numberKeys) assert.ok(Math.abs(e[key] - orig[key]) < 1e-3, key);
    assert.ok(Math.abs(e.angle - orig.angle) <= 0.0005 + 1e-9, 'angle');
    // усе, крім чисел з плаваючою комою, має збігтися точно
    assert.deepEqual(
      { ...e, x: 0, y: 0, vx: 0, vy: 0, angle: 0 },
      { ...orig, x: 0, y: 0, vx: 0, vy: 0, angle: 0 },
    );
  });
});

test('декодер не кидає винятків, а повертає помилку', () => {
  const bytes = new Uint8Array(encodeInput(must(inputs[1])));
  bytes[0] = 7;
  assert.deepEqual(decodeInput(bytes), { ok: false, error: 'version 7' });
  assert.deepEqual(decodeInput(new Uint8Array([1, 1, 0])), {
    ok: false,
    error: 'too short',
  });

  const turn = new Uint8Array(encodeInput(must(inputs[0])));
  turn[6] = 100; // turn = 100 - чит
  assert.deepEqual(decodeInput(turn), { ok: false, error: 'turn 100' });

  const snap = new Uint8Array(encodeSnapshot(snapshot));
  snap[12 + 2] = 9; // невідомий kind
  assert.equal(decodeSnapshot(snap).ok, false);
  assert.equal(decodeSnapshot(snap.subarray(0, 20)).ok, false); // обрізаний
});

test('Node Buffer з ненульовим зсувом теж читається (так дає ws)', () => {
  const input = must(inputs[1]);
  const big = Buffer.alloc(20);
  Buffer.from(encodeInput(input)).copy(big, 5);
  assert.deepEqual(decodeInput(big.subarray(5, 13)), { ok: true, value: input });
});

test('JSON-кодек: той самий знімок після Zod-перевірки', () => {
  const text = jsonCodec.encodeSnapshot(snapshot);
  assert.equal(typeof text, 'string');
  assert.deepEqual(jsonCodec.decodeSnapshot(text), { ok: true, value: snapshot });
  assert.equal(jsonCodec.decodeSnapshot('{"tick":-1}').ok, false);
});
