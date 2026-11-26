import { describe, expect, it } from 'vitest';
import { HumanInput, percentile } from '../src/match.ts';
import { Room, type PlayerConn } from '../src/rooms.ts';
import { World } from 'shared/sim/world.ts';
import { Ship } from 'shared/sim/ship.ts';
import { Vector2 } from 'shared/sim/vector.ts';
import { ARENA } from 'shared/sim/arena.ts';
import { asPlayerId, asSeq } from 'shared/types.ts';
import type { Input } from 'shared/protocol.ts';

const input = (seq: number): Input => ({ seq: asSeq(seq), turn: 0, thrust: true, fire: false, missile: false, flip: false });

describe('HumanInput', () => {
  const world = new World(ARENA, {}, 1);
  const ship = new Ship(new Vector2(0, 0));

  it('віддає input по порядку seq, навіть якщо прийшли переплутані', () => {
    const h = new HumanInput();
    h.push(input(3));
    h.push(input(1));
    h.push(input(2));
    expect(h.take(world, ship).map((i) => i.seq)).toEqual([1, 2, 3]);
    expect(h.lastSeq).toBe(3);
    expect(h.take(world, ship)).toEqual([]);
  });

  it('старі й повтори відкидаються', () => {
    const h = new HumanInput();
    h.push(input(5));
    h.take(world, ship);
    h.push(input(5));
    h.push(input(4));
    expect(h.take(world, ship)).toEqual([]);
  });

  it('черга не більша за 10, решта рахується як dropped', () => {
    const h = new HumanInput();
    for (let i = 1; i <= 15; i++) h.push(input(i));
    expect(h.take(world, ship)).toHaveLength(10);
    expect(h.dropped).toBe(5);
  });
});

describe('percentile', () => {
  it('найближчий ранг', () => {
    const list = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(list, 50)).toBe(50);
    expect(percentile(list, 99)).toBe(99);
    expect(percentile(list, 100)).toBe(100);
    expect(percentile([], 99)).toBe(0);
  });
});

describe('кімната з ботами', () => {
  const conn = (id: number): PlayerConn => ({ id: asPlayerId(id), name: `p${id}`, codec: 'binary', sendSnapshot: () => {}, sendText: () => {} });

  it('боти не займають місць людей, їх не більше 16, у roster вони є', () => {
    const room = new Room({ id: 'b', name: 'B', maxPlayers: 2 });
    expect(room.addBots(10)).toBe(10);
    expect(room.addBots(10)).toBe(16);
    room.add(conn(1));
    room.add(conn(2));
    expect(room.isFull).toBe(true);
    expect(room.roster()).toHaveLength(18);
    room.remove(asPlayerId(1));
    room.remove(asPlayerId(2)); // людей немає - матч зупиняється разом з ботами
    expect(room.match).toBeNull();
  });
});
