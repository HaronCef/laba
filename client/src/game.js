import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { Vector2 } from './sim/vector.js';
import { World } from './sim/world.js';
import { Ship } from './sim/ship.js';
import { createStars, drawBackground, drawWorld, drawHud } from './render/draw.js';
import { createHud } from './hud.js';

// Сама гра: стартує, коли ассети завантажені і гравець натиснув Join у лобі.

const params = new URLSearchParams(location.search);
// Експерименти лаби 1: ?exp=1, ?exp=2, ?exp=3
const exp = params.get('exp');
// Баг з this (лаба 2): ?bug=this
const bug = params.get('bug');

const MODE_NAMES = {
  1: 'exp 1: 100 ms блок кожен 60-й кадр',
  2: 'exp 2: setInterval(frame, 16)',
  3: 'exp 3: змінний крок, без акумулятора',
};

export function startGame({ ctx, size, arena, assets, room, pilotName, audio }) {
  const input = createInput(window);
  const config = { ...assets.arena, ...room.arena };
  const stars = createStars(config.stars || 180);

  const world = new World(arena, config);
  const ship = world.spawn(new Ship(new Vector2(arena.width / 2, arena.height / 2)));
  audio.listenTo(world);
  const hud = createHud(world);
  const inputs = new Map(); // id корабля -> керування

  // ---------- стрільба: тут живе баг з this ----------
  if (bug === 'this') {
    // НАЇВНО: передаємо сам метод. Браузер викличе його з this === window,
    // тому fire() запише window.shotQueued = true, а корабель не вистрілить.
    window.addEventListener('keydown', ship.fire);
  } else {
    // ФІКС: стрілка викликає метод як ship.fire(), тому this === ship
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space') ship.fire();
      if (event.code === 'KeyE') ship.fireMissile();
      if (event.code === 'KeyM') audio.toggleMute();
    });
  }

  // для експерименту 3 з лаби 1: шлях за 5 с тяги
  let thrustTime = 0;
  let distance = 0;
  let result5s = null;

  function readControls() {
    return {
      left: input.isDown('ArrowLeft') || input.isDown('KeyA'),
      right: input.isDown('ArrowRight') || input.isDown('KeyD'),
      thrust: input.isDown('ArrowUp') || input.isDown('KeyW'),
      flip: input.justPressed('KeyS') || input.justPressed('ArrowDown'),
    };
  }

  function simulate(dt) {
    if (input.justPressed('KeyR')) {
      // корабель у центр і на місці (для замірів)
      ship.pos = new Vector2(arena.width / 2, arena.height / 2);
      ship.vel = new Vector2(0, 0);
      ship.angle = -Math.PI / 2;
      ship.savePrevious();
      thrustTime = 0;
      distance = 0;
      result5s = null;
    }

    const controls = readControls();
    inputs.set(ship.id, controls);
    world.step(dt, inputs);

    if (controls.thrust && result5s === null) {
      thrustTime += dt;
      distance += ship.vel.length() * dt;
      if (thrustTime >= 5 - 1e-9) {
        result5s = distance;
        console.log(`[exp3] за 5 с тяги пролетіли ${distance.toFixed(2)} px`);
      }
    }

    input.endStep();
  }

  let frameNumber = 0;

  function busyWait(ms) {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      // нічого не робимо, просто тримаємо потік
    }
  }

  function render(alpha) {
    frameNumber++;
    if (exp === '1' && frameNumber % 60 === 0) {
      busyWait(100);
    }

    const s = loop.stats;
    const effects = [];
    if (ship.effects.shield > 0) effects.push(`щит ${ship.effects.shield.toFixed(1)}`);
    if (ship.effects.triple > 0) effects.push(`x3 ${ship.effects.triple.toFixed(1)}`);

    const lines = [
      `${pilotName} @ ${room.name}`,
      `steps/s: ${s.stepsPerSec}   frames/s: ${s.framesPerSec}`,
      `frame time: ${s.frameTime.toFixed(1)} ms (робота ${s.workTime.toFixed(2)} ms)`,
      `10 s: dt ${s.minDt.toFixed(1)}..${s.maxDt.toFixed(1)} ms, jitter ${s.jitter.toFixed(2)}`,
      `хвиля: ${world.wave}   смертей: ${ship.deaths}`,
      ship.isDead ? `респаун через ${ship.respawnTimer.toFixed(1)} с` : `hp: ${ship.hp}`,
      `бонуси: ${effects.length ? effects.join(', ') : '-'}`,
      `сутностей у світі: ${world.size}`,
    ];
    if (exp === '3') {
      lines.push(
        result5s === null ? 'шлях за 5 с: -' : `шлях за 5 с: ${result5s.toFixed(2)} px`,
      );
    }
    if (MODE_NAMES[exp]) lines.push(MODE_NAMES[exp]);
    if (bug === 'this') lines.push('?bug=this: Space не стріляє (this === window)');
    if (!assets.sprites) lines.push('спрайти не завантажились - малюю фігурами');
    lines.push('W тяга, A/D поворот, S розворот, Space постріл, E ракета, M звук');

    drawBackground(ctx, size.width, size.height, stars);
    drawWorld(ctx, world, alpha, assets.sprites);
    drawHud(ctx, lines);
    hud.draw(ctx, size.width);
  }

  const loop = createLoop({
    step: 1 / 60,
    simulate,
    render,
    useInterval: exp === '2',
    fixedStep: exp !== '3',
  });

  loop.start();
}
