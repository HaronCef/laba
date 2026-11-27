import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { asSeq } from '../src/types.ts';
import { CLOSE, clientMessage, parseClientMessage, parseServerMessage, serverMessage, type ClientMessage } from '../src/protocol.ts';

function code(raw: unknown): number | 'ok' {
  const result = parseClientMessage(raw);
  return result.ok ? 'ok' : result.error.code;
}

describe('parseClientMessage', () => {
  it('правильні повідомлення проходять', () => {
    expect(code('{"v":0,"type":"join","room":"belt","name":"Kyrylo"}')).toBe('ok');
    expect(code('{"v":0,"type":"chat","text":"привіт"}')).toBe('ok');
    expect(code('{"v":0,"type":"leave"}')).toBe('ok');
    expect(code('{"v":0,"type":"input","seq":5,"turn":-1,"thrust":true,"fire":false,"missile":false,"flip":false}')).toBe('ok');
  });

  it.each([
    ['не json', CLOSE.BAD_MESSAGE],
    ['[1,2]', CLOSE.BAD_VERSION],
    ['{"v":1,"type":"chat","text":"x"}', CLOSE.BAD_VERSION],
    ['{"v":0,"type":"fly"}', CLOSE.UNKNOWN_TYPE],
    ['{"v":0,"type":"constructor"}', CLOSE.UNKNOWN_TYPE],
    ['{"v":0,"type":"chat","text":""}', CLOSE.BAD_MESSAGE],
    [`{"v":0,"type":"chat","text":"${'a'.repeat(201)}"}`, CLOSE.BAD_MESSAGE],
    ['{"v":0,"type":"join","room":"../x","name":"a"}', CLOSE.BAD_MESSAGE],
    ['{"v":0,"type":"input","seq":5,"turn":1000,"thrust":true,"fire":false,"missile":false,"flip":false}', CLOSE.BAD_MESSAGE],
  ])('зламане %s -> свій код закриття', (raw, expected) => {
    expect(code(raw)).toBe(expected);
  });

  it('не рядок - теж помилка, а не виняток', () => {
    expect(code(42)).toBe(CLOSE.BAD_MESSAGE);
    expect(code(null)).toBe(CLOSE.BAD_MESSAGE);
  });

  it('serverMessage / parseServerMessage: туди й назад', () => {
    const text = serverMessage({ type: 'pong', t: 12.5 });
    expect(parseServerMessage(text)).toEqual({ ok: true, value: { v: 0, type: 'pong', t: 12.5 } });
    expect(parseServerMessage('{"v":0,"type":"nope"}').ok).toBe(false);
  });
});

// ---------- властивості ----------
const seq = fc.integer({ min: 0, max: 0xffffffff }).map(asSeq);
const validMessage: fc.Arbitrary<ClientMessage> = fc.oneof(
  fc.record({
    v: fc.constant(0 as const),
    type: fc.constant('join' as const),
    room: fc.stringMatching(/^[a-z0-9-]{1,32}$/),
    name: fc.stringMatching(/^[A-Za-z0-9_]{1,16}$/),
  }),
  fc.record({ v: fc.constant(0 as const), type: fc.constant('chat' as const), text: fc.stringMatching(/^[a-zA-Z0-9]{1,200}$/) }),
  fc.record({ v: fc.constant(0 as const), type: fc.constant('leave' as const) }),
  fc.record({
    v: fc.constant(0 as const),
    type: fc.constant('input' as const),
    seq,
    turn: fc.constantFrom(-1 as const, 0 as const, 1 as const),
    thrust: fc.boolean(),
    fire: fc.boolean(),
    missile: fc.boolean(),
    flip: fc.boolean(),
  }),
  fc.record({ v: fc.constant(0 as const), type: fc.constant('ping' as const), t: fc.double({ noNaN: true, noDefaultInfinity: true }) }),
  fc.record({
    v: fc.constant(0 as const),
    type: fc.constant('netsim' as const),
    lag: fc.integer({ min: 0, max: 1000 }),
    jitter: fc.integer({ min: 0, max: 500 }),
    drop: fc.double({ min: 0, max: 0.5, noNaN: true }),
  }),
);

// "Мутації": беремо правильне повідомлення і ламаємо його одним способом
type Mutation = (m: Record<string, unknown>) => Record<string, unknown>;
const mutation: fc.Arbitrary<{ name: string; apply: Mutation }> = fc.oneof(
  fc.integer({ min: 1, max: 99 }).map((v) => ({ name: 'version', apply: (m: Record<string, unknown>) => ({ ...m, v }) })),
  fc.constantFrom('fly', 'JOIN', '', 'toString').map((type) => ({ name: 'type', apply: (m: Record<string, unknown>) => ({ ...m, type }) })),
  fc.constant({ name: 'no v', apply: ({ v: _v, ...rest }: Record<string, unknown>) => rest }),
  fc.constantFrom(1000, -5, 'вліво', null).map((turn) => ({ name: 'turn', apply: (m: Record<string, unknown>) => ({ ...m, type: 'input', seq: 1, thrust: true, fire: false, missile: false, flip: false, turn }) })),
  fc.constantFrom('', ' ', '../etc', 'A'.repeat(33)).map((room) => ({ name: 'room', apply: (m: Record<string, unknown>) => ({ ...m, type: 'join', name: 'x', room }) })),
);

describe('властивості протоколу (fast-check)', () => {
  it('будь-яке згенероване правильне повідомлення проходить і не змінюється', () => {
    fc.assert(
      fc.property(validMessage, (msg) => {
        const text = clientMessage(msg);
        const result = parseClientMessage(text);
        expect(result.ok).toBe(true);
        // порівнюємо після JSON: fast-check знайшов t = -0, а JSON робить з нього 0
        if (result.ok) expect(result.value).toEqual(JSON.parse(text));
      }),
      { numRuns: 500 },
    );
  });

  it('мутоване повідомлення відхиляється з кодом 4000/4001/4002, без винятків', () => {
    fc.assert(
      fc.property(validMessage, mutation, (msg, mut) => {
        const broken = mut.apply({ ...msg });
        const result = parseClientMessage(JSON.stringify(broken));
        expect(result.ok).toBe(false);
        if (!result.ok) expect([CLOSE.BAD_MESSAGE, CLOSE.UNKNOWN_TYPE, CLOSE.BAD_VERSION]).toContain(result.error.code);
      }),
      { numRuns: 500 },
    );
  });

  it('будь-який рядок: parseClientMessage ніколи не кидає виняток', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json()), (raw) => {
        expect(() => parseClientMessage(raw)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });
});
