// Генерує великий штучний лог матчу (за замовчуванням 200 МБ) для перевірки backpressure.
// npm run make-big-log --workspace=server            -> 200 МБ
// npm run make-big-log --workspace=server -- 50      -> 50 МБ
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { loadConfig } from '../src/config.ts';
import { NdjsonTransform } from '../src/log/matchlog.ts';
import type { LogEvent } from '../src/log/logEvent.ts';

const megabytes = Number(process.argv[2]) || 200;
const config = loadConfig();
if (!config.ok) throw new Error(config.error);
mkdirSync(config.value.logDir, { recursive: true });
const file = path.join(config.value.logDir, 'big-test.ndjson');

// генератор подій; pipeline сам бере їх тоді, коли файл встигає записати
function* fakeEvents(): Generator<LogEvent> {
  const target = megabytes * 1024 * 1024;
  let written = 0;
  let t = Date.now();
  while (written < target) {
    const event: LogEvent = {
      t: t++,
      room: 'big-test',
      type: 'chat',
      player: written % 7,
      text: 'повідомлення для перевірки потоків '.repeat(3),
    };
    written += Buffer.byteLength(JSON.stringify(event)) + 1;
    yield event;
  }
}

const start = Date.now();
await pipeline(Readable.from(fakeEvents()), new NdjsonTransform(), createWriteStream(file));
console.log(`${file}: ${megabytes} МБ за ${((Date.now() - start) / 1000).toFixed(1)} с`);
