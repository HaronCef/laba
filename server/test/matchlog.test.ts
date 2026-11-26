import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Room, type PlayerConn } from '../src/rooms.ts';
import { startMatchLog } from '../src/log/matchlog.ts';
import { readEvents } from '../src/log/replay.ts';
import { asPlayerId } from 'shared/types.ts';

function fakeConn(id: number, name: string): PlayerConn {
  return {
    id: asPlayerId(id),
    name,
    codec: 'binary',
    sendSnapshot: () => {},
    sendText: () => {},
  };
}

test('події кімнати потрапляють у NDJSON і читаються назад', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'matchlog-'));
  const room = new Room({ id: 'test', name: 'Test', maxPlayers: 4 });
  const done = startMatchLog(room, dir);

  const a = fakeConn(1, 'A');
  const b = fakeConn(2, 'B');
  room.add(a);
  room.add(b);
  room.chat(a, 'привіт');
  room.remove(a.id);
  room.remove(b.id); // кімната порожня -> лог закривається, матч зупиняється

  const file = await done;
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 5);

  const types: string[] = [];
  for await (const event of readEvents(file)) types.push(event.type);
  assert.deepEqual(types, ['join', 'join', 'chat', 'leave', 'leave']);
});
