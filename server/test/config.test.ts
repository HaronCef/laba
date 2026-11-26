import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('config', () => {
  it('значення за замовчуванням', () => {
    const ok = loadConfig({});
    expect(ok.ok && ok.value.port).toBe(3000);
    expect(ok.ok && ok.value.maxRooms).toBe(20);
  });

  it('порожній рядок = default, число з рядка', () => {
    const port = loadConfig({ PORT: '8080', MAX_PLAYERS: '' });
    expect(port.ok && port.value.port).toBe(8080);
    expect(port.ok && port.value.maxPlayersPerRoom).toBe(8);
  });

  it('неправильні значення - помилка, а не виняток', () => {
    expect(loadConfig({ PORT: 'abc' }).ok).toBe(false);
    expect(loadConfig({ PORT: '70000' }).ok).toBe(false);
    expect(loadConfig({ MAX_PLAYERS: '1' }).ok).toBe(false);
  });

  it('лаба 8: ALLOWED_ORIGINS через кому, TRUST_PROXY, LOG_LEVEL', () => {
    const c = loadConfig({ ALLOWED_ORIGINS: 'https://a.com, http://localhost:5173 ,', TRUST_PROXY: '1' });
    expect(c.ok && c.value.allowedOrigins).toEqual(['https://a.com', 'http://localhost:5173']);
    expect(c.ok && c.value.trustProxy).toBe(true);
    expect(c.ok && c.value.maxConnPerIp).toBe(10);
    expect(loadConfig({ LOG_LEVEL: 'loud' }).ok).toBe(false);
    expect(loadConfig({ MAX_CONN_PER_IP: '0' }).ok).toBe(false);
  });
});
