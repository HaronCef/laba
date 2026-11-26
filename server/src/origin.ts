import type { IncomingHttpHeaders } from 'node:http';

// CORS на WebSocket не діє: будь-який сайт може відкрити ws:// до нашого сервера з браузера гравця.
// Тому на рукостисканні дивимось на заголовок Origin, який браузер ставить сам і підробити не дає.
export function originAllowed(origin: string | undefined, host: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) return true; // не браузер (load test, curl) - Origin ставить лише браузер
  if (allowed.includes('*') || allowed.includes(origin)) return true;
  // сторінку віддав цей самий сервер (та сама адреса) - теж можна
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// IP клієнта. За проксі хостингу remoteAddress - це сам проксі, справжній IP - у X-Forwarded-For.
// Але вірити цьому заголовку можна лише за проксі (TRUST_PROXY=1), інакше його підставить будь-хто.
// (приймає будь-що з headers і socket - тобто IncomingMessage, а в тесті простий об'єкт)
export function clientIp(req: { headers: IncomingHttpHeaders; socket: { remoteAddress?: string | undefined } }, trustProxy: boolean): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (trustProxy && typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
