import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { DT } from 'shared/sim/constants.js';
import { ARENA } from 'shared/sim/arena.js';
import {
  arenaView,
  createExplosion,
  createStars,
  drawBackground,
  drawExplosions,
  drawHud,
  drawWorld,
} from './render/draw.js';
import { createHud } from './hud.js';
import { createNetgraph } from './net/netgraph.js';

// Сама гра (лаба 5): світ рахує сервер, тут лише input, прогноз свого корабля і малювання.
// net - NetClient (net/netclient.js), connection - Connection (net/connection.js)

export function startGame({
  ctx,
  size,
  assets,
  room,
  pilotName,
  audio,
  net,
  connection,
  netPreset,
}) {
  const input = createInput(window);
  const stars = createStars(assets.arena?.stars || 180);
  const hud = createHud(net);
  const netgraph = createNetgraph(net, connection, { initialPreset: netPreset });
  audio.listenTo(net);
  window.spaceDuel = { net, connection }; // щоб дивитись стан у DevTools (і для замірів у README)

  const names = new Map(); // shipId -> ім'я
  connection.addEventListener('roster', (e) => {
    names.clear();
    for (const p of e.detail.players) names.set(p.shipId, p.name);
  });

  let explosions = [];
  net.addEventListener('exploded', (e) => {
    const d = e.detail;
    const color = d.kind === 'ship' ? '#8fa2ff' : '#ffb347';
    explosions.push(
      createExplosion(d.x, d.y, d.kind === 'ship' ? 30 : d.size * 10, color),
    );
  });

  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyM') audio.toggleMute();
  });

  // один крок = один input на сервер (і один крок прогнозу)
  function simulate() {
    net.sendInput({
      turn:
        (input.isDown('ArrowRight') || input.isDown('KeyD') ? 1 : 0) -
        (input.isDown('ArrowLeft') || input.isDown('KeyA') ? 1 : 0),
      thrust: input.isDown('ArrowUp') || input.isDown('KeyW'),
      fire: input.isDown('Space'),
      missile: input.isDown('KeyE'),
      flip: input.justPressed('KeyS') || input.justPressed('ArrowDown'),
    });
    input.endStep();
  }

  let lastFrame = performance.now();

  function render(alpha) {
    const now = performance.now();
    const frameDt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    drawBackground(ctx, size.width, size.height, stars);

    // світ у координатах арени, вписаної у вікно
    const view = arenaView(size.width, size.height, ARENA);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);
    ctx.strokeStyle = 'rgba(91, 108, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, ARENA.width, ARENA.height);
    drawWorld(ctx, net.renderList(alpha, frameDt, now), assets.sprites, names);
    explosions = drawExplosions(ctx, explosions, frameDt);
    hud.drawPopups(ctx);
    ctx.restore();

    const me = net.me;
    const s = loop.stats;
    drawHud(ctx, [
      `${pilotName} @ ${room.name}   гравців: ${names.size}`,
      `steps/s: ${s.stepsPerSec}   frames/s: ${s.framesPerSec}`,
      !me
        ? 'чекаю перший знімок...'
        : net.isDead
          ? 'корабель знищено, респаун...'
          : `hp: ${me.extra}`,
      'W газ, A/D поворот, S розворот, Space постріл, E ракета, M звук',
    ]);
    hud.drawScore(ctx, size.width);
    netgraph.draw(ctx, size.width - 10, 50);
  }

  const loop = createLoop({ step: DT, simulate, render });
  loop.start();
}
