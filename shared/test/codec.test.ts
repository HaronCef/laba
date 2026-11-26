import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { decodeInput, decodeSnapshot, encodeInput, encodeSnapshot, withAck } from '../src/codec/binary.ts';
import { binaryCodec, jsonCodec, parseInputJson, pickCodec } from '../src/codec/index.ts';
import { normalizeAngle } from '../src/sim/vector.ts';
import { asEntityId, asSeq, asTick } from '../src/types.ts';
import type { EntityRecord, Input, Snapshot } from '../src/protocol.ts';

const HEADER = 12;
const ENTITY = 26;

const snapshot: Snapshot = {
  tick: asTick(987654),
  ack: asSeq(4321),
  entities: [
    { kind: 'ship', id: asEntityId(1), x: 640.25, y: 10.5, vx: -120.75, vy: 33.125, angle: 3.14159, thrust: true, shield: true, triple: false, dead: false, shotCd: 3, missileCd: 40, hp: 100 },
    { kind: 'bullet', id: asEntityId(65535), x: 0, y: 719.75, vx: 520, vy: -1, angle: -2.5, missile: true, owner: asEntityId(1), shotId: 65535 },
    { kind: 'asteroid', id: asEntityId(7), x: 1279.5, y: 0.25, vx: 1, vy: 2, angle: 0, big: true, hunter: true, hp: 3 },
    { kind: 'pickup', id: asEntityId(8), x: 5, y: 6, vx: 0, vy: 0, angle: 0, effect: 'triple' },
  ],
};

// ---------- генератори для fast-check ----------
const u16 = fc.integer({ min: 0, max: 0xffff });
const f32 = fc.float({ noNaN: true, noDefaultInfinity: true }); // float32 - кодується без втрат
const angle = fc.double({ min: -100, max: 100, noNaN: true }); // будь-який кут, кодек сам нормалізує
const base = { id: u16.map(asEntityId), x: f32, y: f32, vx: f32, vy: f32, angle };
const entityArb: fc.Arbitrary<EntityRecord> = fc.oneof(
  fc.record({ kind: fc.constant('ship' as const), ...base, thrust: fc.boolean(), shield: fc.boolean(), triple: fc.boolean(), dead: fc.boolean(), shotCd: fc.integer({ min: 0, max: 255 }), missileCd: fc.integer({ min: 0, max: 255 }), hp: u16 }),
  fc.record({ kind: fc.constant('bullet' as const), ...base, missile: fc.boolean(), owner: u16.map(asEntityId), shotId: u16 }),
  fc.record({ kind: fc.constant('asteroid' as const), ...base, big: fc.boolean(), hunter: fc.boolean(), hp: u16 }),
  fc.record({ kind: fc.constant('pickup' as const), ...base, effect: fc.constantFrom('shield' as const, 'triple' as const) }),
);
const snapshotArb: fc.Arbitrary<Snapshot> = fc.record({
  tick: fc.integer({ min: 0, max: 0xffffffff }).map(asTick),
  ack: fc.integer({ min: 0, max: 0xffffffff }).map(asSeq),
  entities: fc.array(entityArb, { maxLength: 60 }),
});
const inputArb: fc.Arbitrary<Input> = fc.record({
  seq: fc.integer({ min: 0, max: 0xffffffff }).map(asSeq),
  turn: fc.constantFrom(-1 as const, 0 as const, 1 as const),
  thrust: fc.boolean(),
  fire: fc.boolean(),
  missile: fc.boolean(),
  flip: fc.boolean(),
});

describe('бінарний кодек', () => {
  it('input: 8 байт і decode(encode(x)) == x', () => {
    const input: Input = { seq: asSeq(123456), turn: -1, thrust: true, fire: true, missile: false, flip: true };
    expect(encodeInput(input).byteLength).toBe(8);
    expect(decodeInput(encodeInput(input))).toEqual({ ok: true, value: input });
  });

  it('декодер не кидає винятків, а повертає помилку з причиною', () => {
    const bytes = new Uint8Array(encodeInput({ seq: asSeq(1), turn: 0, thrust: false, fire: false, missile: false, flip: false }));
    bytes[0] = 7;
    expect(decodeInput(bytes)).toEqual({ ok: false, error: 'version 7' });
    expect(decodeInput(new Uint8Array([1, 1, 0]))).toEqual({ ok: false, error: 'too short' });
    bytes[0] = 1;
    bytes[6] = 100; // turn = 100 - чит
    expect(decodeInput(bytes)).toEqual({ ok: false, error: 'turn 100' });
  });

  it('знімок: невідомий kind і обрізаний буфер - помилка', () => {
    const snap = new Uint8Array(encodeSnapshot(snapshot));
    snap[HEADER + 2] = 9;
    expect(decodeSnapshot(snap).ok).toBe(false);
    expect(decodeSnapshot(new Uint8Array(encodeSnapshot(snapshot)).subarray(0, 20)).ok).toBe(false);
  });

  it('Node Buffer з ненульовим зсувом теж читається (так дає ws)', () => {
    const input: Input = { seq: asSeq(9), turn: 1, thrust: false, fire: true, missile: false, flip: false };
    const big = Buffer.alloc(20);
    Buffer.from(encodeInput(input)).copy(big, 5);
    expect(decodeInput(big.subarray(5, 13))).toEqual({ ok: true, value: input });
  });

  it('withAck: копія з іншим ack, оригінал не змінюється (encode один раз на всіх)', () => {
    const once = encodeSnapshot(snapshot);
    const mine = withAck(once, asSeq(77));
    expect(mine).not.toBe(once);
    const a = decodeSnapshot(mine);
    const b = decodeSnapshot(once);
    expect(a.ok && a.value.ack).toBe(77);
    expect(b.ok && b.value.ack).toBe(4321);
  });

  it('JSON-кодек: той самий знімок після Zod-перевірки', () => {
    const text = jsonCodec.encodeSnapshot(snapshot);
    expect(typeof text).toBe('string');
    expect(jsonCodec.decodeSnapshot(text)).toEqual({ ok: true, value: snapshot });
    expect(jsonCodec.decodeSnapshot('{"tick":-1}').ok).toBe(false);
    expect(pickCodec('binary')).toBe(binaryCodec);
    expect(parseInputJson({ seq: 1, turn: 5 }).ok).toBe(false);
  });
});

describe('властивості кодека (fast-check)', () => {
  it('round-trip знімка: усе точно, крім кута - він квантується до 0.001 рад', async () => {
    await fc.assert(
      fc.property(snapshotArb, (snap) => {
        const back = decodeSnapshot(encodeSnapshot(snap));
        expect(back.ok).toBe(true);
        if (!back.ok) return;
        expect(back.value.tick).toBe(snap.tick);
        expect(back.value.ack).toBe(snap.ack);
        expect(back.value.entities).toHaveLength(snap.entities.length);
        back.value.entities.forEach((e, i) => {
          const orig = snap.entities[i];
          if (!orig) throw new Error('немає сутності');
          // кут квантується до 0.001, тому похибка до 0.0005
          expect(Math.abs(normalizeAngle(e.angle - orig.angle))).toBeLessThanOrEqual(0.0005 + 1e-9);
          expect({ ...e, angle: 0 }).toEqual({ ...orig, angle: 0 });
        });
      }),
      { numRuns: 300 },
    );
  });

  it('довжина закодованого знімка = 12 + 26 * кількість (як у специфікації)', async () => {
    await fc.assert(
      fc.property(snapshotArb, (snap) => {
        expect(encodeSnapshot(snap).byteLength).toBe(HEADER + ENTITY * snap.entities.length);
      }),
    );
  });

  it('input: round-trip для будь-якого правильного input, завжди 8 байт', async () => {
    await fc.assert(
      fc.property(inputArb, (input) => {
        const bytes = encodeInput(input);
        expect(bytes.byteLength).toBe(8);
        expect(decodeInput(bytes)).toEqual({ ok: true, value: input });
      }),
    );
  });

  it('сміття замість байтів: не падає, а повертає типізовану помилку (ok: false + рядок)', async () => {
    await fc.assert(
      fc.property(fc.uint8Array({ maxLength: 400 }), (bytes) => {
        for (const result of [decodeSnapshot(bytes), decodeInput(bytes)]) {
          if (!result.ok) expect(typeof result.error).toBe('string');
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('сміття всередині правильного заголовка (найкраще ловить помилки розбору сутностей)', async () => {
    const header = new Uint8Array(encodeSnapshot({ ...snapshot, entities: [] }));
    await fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), fc.uint8Array({ maxLength: 26 * 20 }), (count, body) => {
        const bytes = new Uint8Array(HEADER + body.length);
        bytes.set(header);
        bytes.set(body, HEADER);
        new DataView(bytes.buffer).setUint16(10, count, true);
        const result = decodeSnapshot(bytes);
        if (result.ok) expect(result.value.entities).toHaveLength(count);
        else expect(typeof result.error).toBe('string');
      }),
      { numRuns: 1000 },
    );
  });
});
