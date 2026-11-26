// Middleware для Vite dev-сервера, щоб перевіряти повільну і нестабільну мережу.
//   ?delay=300  - відповісти на 300 мс пізніше
//   ?flaky=2    - перші 2 запити на цей файл отримують 503, третій нормальний

const flakyCounters = new Map(); // шлях -> скільки разів уже відмовили

export function slowAndFlaky(req, res, next) {
  const url = new URL(req.url, 'http://localhost');
  const delay = Number(url.searchParams.get('delay') || 0);
  const flaky = Number(url.searchParams.get('flaky') || 0);

  if (flaky > 0) {
    const failed = flakyCounters.get(url.pathname) || 0;
    if (failed < flaky) {
      flakyCounters.set(url.pathname, failed + 1);
      res.statusCode = 503;
      res.end('Service Unavailable (flaky test)');
      return;
    }
    flakyCounters.delete(url.pathname); // наступне завантаження знову буде "нестабільним"
  }

  if (delay > 0) {
    setTimeout(next, delay);
  } else {
    next();
  }
}
