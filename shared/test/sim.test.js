import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { Ship, setBreakDeterminism } from '../src/sim/ship.js';
import { Vector2 } from '../src/sim/vector.js';
import { ARENA } from '../src/sim/arena.js';
import { DT } from '../src/sim/constants.js';
import { hashNumbers } from '../src/hash.js';
import { runScriptedShip, scriptedInput } from '../src/scripted.js';

// Якщо цей файл узагалі імпортувався в Node, симуляція не залежить від DOM (window, document, canvas)
test('симуляція імпортується в Node без DOM', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof World, 'function');
});

function runWorld(seed) {
  const world = new World(ARENA, {}, seed);
  const a = world.spawn(new Ship(new Vector2(300, 300), { name: 'A' }));
  const b = world.spawn(new Ship(new Vector2(900, 400), { name: 'B' }));
  for (let i = 0; i < 600; i++) {
    a.applyInput(scriptedInput(i), world);
    b.applyInput(scriptedInput(i + 50), world);
    world.step(DT);
  }
  const numbers = [];
  for (const e of world)
    numbers.push(e.netId, e.pos.x, e.pos.y, e.vel.x, e.vel.y, e.angle);
  return hashNumbers(numbers);
}

test('той самий seed і input -> той самий стан світу', () => {
  assert.equal(runWorld(42), runWorld(42));
  assert.notEqual(runWorld(42), runWorld(43));
});

test('корабель: 1000 кроків дають однаковий хеш, а з Math.random() - ні', () => {
  const first = runScriptedShip();
  assert.equal(runScriptedShip(), first);

  setBreakDeterminism(true);
  const broken1 = runScriptedShip();
  const broken2 = runScriptedShip();
  setBreakDeterminism(false);
  assert.notEqual(broken1, broken2);
});
