import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Room } from '../src/rooms.js';
import { startMatchLog } from '../src/log/matchlog.js';
import { readEvents } from '../src/log/replay.js';

test('події кімнати потрапляють у NDJSON і читаються назад', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'matchlog-'));
  const room = new Room({ id: 'test', name: 'Test', maxPlayers: 4 });
  const done = startMatchLog(room, dir);

  room.add({ id: 1, name: 'A' });
  room.add({ id: 2, name: 'B' });
  room.chat({ id: 1, name: 'A' }, 'привіт');
  room.remove(1);
  room.remove(2); // кімната порожня -> лог закривається

  const file = await done;
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 5);

  const types = [];
  for await (const event of readEvents(file)) types.push(event.type);
  assert.deepEqual(types, ['join', 'join', 'chat', 'leave', 'leave']);
});
