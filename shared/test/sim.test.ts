import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.ts';
import { Ship, setBreakDeterminism } from '../src/sim/ship.ts';
import { Vector2 } from '../src/sim/vector.ts';
import { ARENA } from '../src/sim/arena.ts';
import { DT } from '../src/sim/constants.ts';
import { hashNumbers } from '../src/hash.ts';
import { runScriptedShip, scriptedInput } from '../src/scripted.ts';

// Якщо цей файл узагалі імпортувався в Node, симуляція не залежить від DOM (window, document, canvas)
test('симуляція імпортується в Node без DOM', () => {
  assert.equal('document' in globalThis, false);
  assert.equal(typeof World, 'function');
});

function runWorld(seed: number): string {
  const world = new World(ARENA, {}, seed);
  const a = world.spawn(new Ship(new Vector2(300, 300), 'A'));
  const b = world.spawn(new Ship(new Vector2(900, 400), 'B'));
  for (let i = 0; i < 600; i++) {
    a.applyInput(scriptedInput(i), world);
    b.applyInput(scriptedInput(i + 50), world);
    world.step(DT);
  }
  const numbers: number[] = [];
  for (const e of world)
    numbers.push(e.netId, e.pos.x, e.pos.y, e.vel.x, e.vel.y, e.angle);
  return hashNumbers(numbers);
}

test('той самий seed і input -> той самий стан світу', () => {
  assert.equal(runWorld(42), runWorld(42));
  assert.notEqual(runWorld(42), runWorld(43));
});

test('корабель: 1000 кроків дають той самий хеш, що й у лабі 5 (JS)', () => {
  // 62305ba3 - хеш JS-версії з лаби 5 (і в Node, і в Chrome). Після переходу на TS має бути такий самий.
  assert.equal(runScriptedShip(), '62305ba3');
});

test('з Math.random() у integrate хеш щоразу інший', () => {
  setBreakDeterminism(true);
  const broken1 = runScriptedShip();
  const broken2 = runScriptedShip();
  setBreakDeterminism(false);
  assert.notEqual(broken1, broken2);
});
