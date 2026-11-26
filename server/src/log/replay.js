import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

// Читає NDJSON-файл рядок за рядком і віддає вже розібрані події.
// Файл не читається в пам'ять цілком: readline отримує його шматками з потоку.
export async function* readEvents(file) {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    yield JSON.parse(line);
  }
}

const SAFE_NAME = /^[A-Za-z0-9-]+\.ndjson$/;

// Повний шлях до файлу логу або null, якщо ім'я підозріле (захист від ../)
export function replayPath(logDir, name) {
  if (!SAFE_NAME.test(name)) return null;
  return path.join(logDir, name);
}

export async function listReplays(logDir) {
  let names;
  try {
    names = await readdir(logDir);
  } catch {
    return []; // папки ще немає
  }
  const result = [];
  for (const name of names
    .filter((n) => SAFE_NAME.test(n))
    .sort()
    .reverse()) {
    const info = await stat(path.join(logDir, name));
    result.push({ id: name, bytes: info.size });
  }
  return result;
}
