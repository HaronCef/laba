import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';

test('конфіг: значення за замовчуванням і перевірка', () => {
  const ok = loadConfig({});
  assert.ok(ok.ok);
  assert.equal(ok.value.port, 3000);
  assert.equal(ok.value.maxRooms, 20);

  const port = loadConfig({ PORT: '8080', MAX_PLAYERS: '' });
  assert.ok(port.ok);
  assert.equal(port.value.port, 8080);
  assert.equal(port.value.maxPlayersPerRoom, 8); // порожнє = default

  const bad = loadConfig({ PORT: 'abc' });
  assert.equal(bad.ok, false);
  assert.equal(loadConfig({ PORT: '70000' }).ok, false);
  assert.equal(loadConfig({ MAX_PLAYERS: '1' }).ok, false);
});
