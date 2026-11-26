import { describe, expect, it } from 'vitest';
import { clientIp, originAllowed } from '../src/origin.ts';

describe('перевірка Origin', () => {
  const allowed = ['http://localhost:5173'];

  it('сторінка з того самого сервера - можна', () => {
    expect(originAllowed('https://space-duel.onrender.com', 'space-duel.onrender.com', [])).toBe(true);
  });

  it('чужий сайт - не можна', () => {
    expect(originAllowed('https://evil.example', 'space-duel.onrender.com', allowed)).toBe(false);
  });

  it('адреса зі списку ALLOWED_ORIGINS - можна, * - усі', () => {
    expect(originAllowed('http://localhost:5173', 'localhost:3000', allowed)).toBe(true);
    expect(originAllowed('https://evil.example', 'x', ['*'])).toBe(true);
  });

  it('без Origin (не браузер) - пускаємо, битий Origin - ні', () => {
    expect(originAllowed(undefined, 'x', [])).toBe(true);
    expect(originAllowed('не адреса', 'x', [])).toBe(false);
  });
});

describe('IP клієнта', () => {
  const req = (forwarded?: string) => ({
    headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
    socket: { remoteAddress: '10.0.0.1' },
  });

  it('без проксі X-Forwarded-For ігнорується (його може підробити будь-хто)', () => {
    expect(clientIp(req('1.2.3.4'), false)).toBe('10.0.0.1');
  });

  it('за проксі - перша адреса з X-Forwarded-For', () => {
    expect(clientIp(req('1.2.3.4, 10.0.0.5'), true)).toBe('1.2.3.4');
    expect(clientIp(req(), true)).toBe('10.0.0.1');
  });
});
