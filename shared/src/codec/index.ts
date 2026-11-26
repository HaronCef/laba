import { decodeSnapshot, encodeInput, encodeSnapshot } from './binary.ts';
import { InputSchema, SnapshotSchema, PROTOCOL_VERSION, type Input, type Snapshot } from '../protocol.ts';
import { fail, ok, type Result } from '../types.ts';

// Два способи передати input і знімки. Вибирається прапорцем ?codec=json,
// а решта коду працює з інтерфейсом Codec і не знає, який саме кодек.
export type CodecName = 'binary' | 'json';

export interface Codec {
  readonly name: CodecName;
  encodeInput(input: Input): string | ArrayBuffer;
  encodeSnapshot(snapshot: Snapshot): string | ArrayBuffer;
  decodeSnapshot(data: string | ArrayBuffer | Uint8Array): Result<Snapshot>;
}

export const binaryCodec: Codec = {
  name: 'binary',
  encodeInput,
  encodeSnapshot,
  decodeSnapshot(data) {
    if (typeof data === 'string') return fail('binary codec got text');
    return decodeSnapshot(data);
  },
};

// JSON-варіант: ті самі дані текстом, з type і v, як інші повідомлення протоколу
export const jsonCodec: Codec = {
  name: 'json',
  encodeInput(input) {
    return JSON.stringify({ v: PROTOCOL_VERSION, type: 'input', ...input });
  },
  encodeSnapshot(snapshot) {
    return JSON.stringify({ v: PROTOCOL_VERSION, type: 'snapshot', ...snapshot });
  },
  decodeSnapshot(data) {
    if (typeof data !== 'string') return fail('json codec got bytes');
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      return fail('not JSON');
    }
    const result = SnapshotSchema.safeParse(raw);
    return result.success ? ok(result.data) : fail(result.error.issues[0]?.message ?? 'bad snapshot');
  },
};

export function pickCodec(name: CodecName): Codec {
  return name === 'json' ? jsonCodec : binaryCodec;
}

// Для JSON-input окремої функції не треба: він приходить як повідомлення type 'input'
// і перевіряється в parseClientMessage. Схема тут для тестів і порівняння.
export function parseInputJson(raw: unknown): Result<Input> {
  const result = InputSchema.safeParse(raw);
  return result.success ? ok(result.data) : fail(result.error.issues[0]?.message ?? 'bad input');
}
