import { createLoop } from './loop.ts';
import { createInput } from './input.ts';
import { DT } from 'shared/sim/constants.ts';
import { ARENA } from 'shared/sim/arena.ts';
import type { EntityId } from 'shared/types.ts';
import type { RoomInfo } from 'shared/protocol.ts';
import {
  arenaView,
  createStars,
  drawBackground,
  drawParticles,
  drawHud,
  drawWorld,
} from './render/draw.ts';
import { createHud } from './hud.ts';
import { ParticlePool } from './render/particles.ts';
import { mark, measure } from './perf.ts';
import { createNetgraph } from './net/netgraph.ts';
import type { Size } from './render/canvas.ts';
import type { Assets } from './assets/loader.ts';
import type { Audio } from './audio.ts';
import type { NetClient } from './net/netclient.ts';
import type { Connection } from './net/connection.ts';

// window.spaceDuel для DevTools і замірів. Без цього оголошення TypeScript
// не дає дописати своє поле у window (у JS я це робив непомітно).
declare global {
  interface Window {
    spaceDuel?: { net: NetClient; connection: Connection };
  }
}

export interface GameOptions {
  ctx: CanvasRenderingContext2D;
  size: Size;
  assets: Assets;
  room: RoomInfo;
  pilotName: string;
  audio: Audio;
  net: NetClient;
  connection: Connection;
  netPreset: number;
  version: string;
}

// Сама гра: світ рахує сервер, тут лише input, прогноз свого корабля і малювання.
export function startGame({ ctx, size, assets, room, pilotName, audio, net, connection, netPreset, version }: GameOptions): void {
  const input = createInput(window);
  const stars = createStars(assets.arena.stars);
  const hud = createHud(net);
  const netgraph = createNetgraph(net, connection, { initialPreset: netPreset });
  audio.listenTo(net);
  window.spaceDuel = { net, connection };

  const names = new Map<EntityId, string>(); // shipId -> ім'я
  connection.on('roster', (msg) => {
    names.clear();
    for (const p of msg.players) names.set(p.shipId, p.name);
  });

  // пул частинок (варіант з воркером пробував - не виграв, див. README)
  const particles = new ParticlePool(800);
  net.on('exploded', (e) => {
    const color = e.kind === 'ship' ? '#8fa2ff' : '#ffb347';
    particles.explode(e.x, e.y, e.kind === 'ship' ? 30 : (e.size ?? 2) * 10, color);
  });

  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyM') audio.toggleMute();
  });

  const right = (): boolean => input.isDown('ArrowRight') || input.isDown('KeyD');
  const left = (): boolean => input.isDown('ArrowLeft') || input.isDown('KeyA');

  // один крок = один input на сервер (і один крок прогнозу)
  function simulate(): void {
    net.sendInput({
      // turn має тип -1 | 0 | 1, тому рахуємо його явно, а не відніманням чисел
      turn: right() === left() ? 0 : right() ? 1 : -1,
      thrust: input.isDown('ArrowUp') || input.isDown('KeyW'),
      fire: input.isDown('Space'),
      missile: input.isDown('KeyE'),
      flip: input.justPressed('KeyS') || input.justPressed('ArrowDown'),
    });
    input.endStep();
  }

  let lastFrame = performance.now();

  // вид арени і HUD перераховуємо лише коли щось змінилось
  let view = arenaView(size.width, size.height, ARENA);
  let viewW = size.width;
  let viewH = size.height;
  const hudLines = ['', '', '', 'W газ, A/D поворот, S розворот, Space постріл, E ракета, M звук'];
  let hudKey = -1;

  function render(alpha: number): void {
    const now = performance.now();
    const frameDt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    drawBackground(ctx, size.width, size.height, stars);

    // світ у координатах арени, вписаної у вікно
    if (viewW !== size.width || viewH !== size.height) {
      view = arenaView(size.width, size.height, ARENA);
      viewW = size.width;
      viewH = size.height;
    }
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);
    ctx.strokeStyle = 'rgba(91, 108, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, ARENA.width, ARENA.height);
    drawWorld(ctx, net.renderList(alpha, frameDt, now), assets.sprites, names);
    mark('particles-start');
    drawParticles(ctx, particles, frameDt);
    measure('particles', 'particles-start');
    hud.drawPopups(ctx);
    ctx.restore();

    const me = net.me;
    const s = loop.stats;
    // якщо щось у HUD змінилось - будуємо рядки заново
    const key = names.size + s.stepsPerSec * 1e3 + s.framesPerSec * 1e6 + (me ? (me.dead ? 1e9 : me.hp * 1e10) : 0);
    if (key !== hudKey) {
      hudKey = key;
      hudLines[0] = `${pilotName} @ ${room.name}   гравців: ${names.size}   ${version}`;
      hudLines[1] = `steps/s: ${s.stepsPerSec}   frames/s: ${s.framesPerSec}`;
      hudLines[2] = !me ? 'чекаю перший знімок...' : me.dead ? 'корабель знищено, респаун...' : `hp: ${me.hp}`;
    }
    drawHud(ctx, hudLines);
    hud.drawScore(ctx, size.width);
    netgraph.draw(ctx, size.width - 10, 50);
  }

  const loop = createLoop({ step: DT, simulate, render });
  loop.start();
}
