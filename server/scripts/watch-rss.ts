// Кожні 500 мс питає /health сервера і друкує "секунди,rss_МБ" (CSV для графіка).
// npx tsx scripts/watch-rss.ts http://127.0.0.1:3000/health 60 > rss.csv
import { z } from 'zod';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/health';
const seconds = Number(process.argv[3]) || 60;
const start = Date.now();
const HealthSchema = z.object({ rssMb: z.number() });

console.log('t,rssMb');
const timer = setInterval(() => {
  const t = (Date.now() - start) / 1000;
  if (t > seconds) {
    clearInterval(timer);
    return;
  }
  fetch(url)
    .then((res) => res.json())
    .then((data: unknown) => {
      const health = HealthSchema.safeParse(data);
      console.log(`${t.toFixed(1)},${health.success ? health.data.rssMb : ''}`);
    })
    .catch(() => console.log(`${t.toFixed(1)},`)); // сервер не відповів
}, 500);
