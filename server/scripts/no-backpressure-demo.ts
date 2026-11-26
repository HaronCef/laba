// Порівняння для README (лаба 4): віддати великий файл НЕПРАВИЛЬНО, ігноруючи backpressure.
// res.write() повертає false, коли клієнт не встигає, але цей код пише далі,
// тому все непрочитане клієнтом накопичується в пам'яті сервера.
// Запуск: npx tsx --env-file=.env scripts/no-backpressure-demo.ts   (порт 3001)
import http from 'node:http';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.ts';

const config = loadConfig();
if (!config.ok) throw new Error(config.error);
const file = path.join(config.value.logDir, 'big-test.ndjson');

http
  .createServer((req, res) => {
    if (req.url === '/health') {
      res.end(
        JSON.stringify({ rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) }),
      );
      return;
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const stream = createReadStream(file);
    stream.on('data', (chunk) => {
      res.write(chunk); // результат ігнорується - ось у чому помилка
    });
    stream.on('end', () => res.end());
  })
  .listen(3001, '127.0.0.1', () => console.log('demo на http://127.0.0.1:3001'));
