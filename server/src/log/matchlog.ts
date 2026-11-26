import { on } from 'node:events';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Room } from '../rooms.ts';

// Transform в object mode: на вхід об'єкти подій, на вихід рядки NDJSON
// (один JSON-об'єкт на рядок).
export class NdjsonTransform extends Transform {
  constructor() {
    super({ writableObjectMode: true });
  }

  override _transform(
    event: unknown,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    callback(null, JSON.stringify(event) + '\n');
  }
}

export function logFileName(roomId: string, date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `${roomId}-${stamp}.ndjson`;
}

// Пише події кімнати у файл LOG_DIR/<room>-<час>.ndjson.
// Повертає проміс, який виконається, коли файл повністю дописаний.
export function startMatchLog(room: Room, logDir: string): Promise<string> {
  mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, logFileName(room.id));

  // events.on починає слухати одразу, тому жодна подія не загубиться.
  // Ітерація закінчується на 'empty' або 'closed'.
  // Типи тут закінчуються: events.on повертає any[], тому беремо елемент як unknown.
  const events = on(room, 'event', { close: ['empty', 'closed'] });
  async function* roomEvents(): AsyncGenerator<unknown> {
    for await (const args of events) {
      const event: unknown = args[0];
      yield event;
    }
  }

  // pipeline сам стежить за backpressure, передає помилки і закриває всі потоки
  return pipeline(
    Readable.from(roomEvents()),
    new NdjsonTransform(),
    createWriteStream(file),
  ).then(() => file);
}
