import { on } from 'node:events';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Transform в object mode: на вхід об'єкти подій, на вихід рядки NDJSON
// (один JSON-об'єкт на рядок).
export class NdjsonTransform extends Transform {
  constructor() {
    super({ writableObjectMode: true });
  }

  _transform(event, _encoding, callback) {
    callback(null, JSON.stringify(event) + '\n');
  }
}

export function logFileName(roomId, date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `${roomId}-${stamp}.ndjson`;
}

// Пише події кімнати у файл LOG_DIR/<room>-<час>.ndjson.
// Повертає проміс, який виконається, коли файл повністю дописаний.
export function startMatchLog(room, logDir) {
  mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, logFileName(room.id));

  // events.on починає слухати одразу (а не коли pipeline почне читати),
  // тому жодна подія не загубиться. Ітерація закінчується на 'empty' або 'closed'.
  const events = on(room, 'event', { close: ['empty', 'closed'] });
  async function* roomEvents() {
    for await (const [event] of events) {
      yield event;
    }
  }

  // pipeline сам стежить за backpressure (якщо диск не встигає - читання зупиняється),
  // передає помилки і закриває всі потоки
  return pipeline(
    Readable.from(roomEvents()),
    new NdjsonTransform(),
    createWriteStream(file),
  ).then(() => file);
}
