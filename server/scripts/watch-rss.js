// Кожні 500 мс питає /health сервера і друкує "секунди,rss_МБ" (CSV для графіка).
// node scripts/watch-rss.js http://127.0.0.1:3000/health 60 > rss.csv
const url = process.argv[2] || 'http://127.0.0.1:3000/health';
const seconds = Number(process.argv[3]) || 60;
const start = Date.now();

console.log('t,rssMb');
const timer = setInterval(async () => {
  const t = (Date.now() - start) / 1000;
  if (t > seconds) {
    clearInterval(timer);
    return;
  }
  try {
    const data = await (await fetch(url)).json();
    console.log(`${t.toFixed(1)},${data.rssMb}`);
  } catch {
    console.log(`${t.toFixed(1)},`); // сервер не відповів
  }
}, 500);
