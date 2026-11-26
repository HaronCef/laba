import { mulberry32 } from 'shared/rng.ts';
import { assertNever, type EntityId } from 'shared/types.ts';
import type { Arena } from 'shared/sim/arena.ts';
import type { Sprites } from '../assets/loader.ts';
import type { Drawable } from './drawable.ts';
import type { ParticlePool } from './particles.ts';

// Малювання. Світ рахує сервер, тому тут на вхід ідуть не сутності,
// а прості об'єкти Drawable з NetClient.renderList() у координатах арени.

type Ctx = CanvasRenderingContext2D;
type Star = { readonly x: number; readonly y: number; readonly r: number; readonly bright: number };

// Зірки зберігаємо у відносних координатах (0..1), щоб при зміні розміру
// вікна вони не збивались в один кут.
export function createStars(count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.4 + 0.3,
      bright: Math.random() * 0.6 + 0.4,
    });
  }
  return stars;
}

// Фон малюємо один раз в окремий canvas, а потім лише копіюємо
// (раніше кожен кадр для кожної зірки створювався рядок rgba(...)).
let background: { canvas: HTMLCanvasElement; width: number; height: number } | null = null;

export function drawBackground(ctx: Ctx, width: number, height: number, stars: readonly Star[]): void {
  if (!background || background.width !== width || background.height !== height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const bg = canvas.getContext('2d');
    if (!bg) return;
    bg.fillStyle = '#05060f';
    bg.fillRect(0, 0, width, height);
    for (const star of stars) {
      bg.fillStyle = `rgba(255, 255, 255, ${star.bright})`;
      bg.beginPath();
      bg.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2);
      bg.fill();
    }
    background = { canvas, width, height };
  }
  ctx.drawImage(background.canvas, 0, 0);
}

// Арена однакова для всіх (1280x720), тому вписуємо її у вікно
export function arenaView(width: number, height: number, arena: Arena): { scale: number; x: number; y: number } {
  const scale = Math.min(width / arena.width, height / arena.height);
  return {
    scale,
    x: (width - arena.width * scale) / 2,
    y: (height - arena.height * scale) / 2,
  };
}

// Кадр зі спрайтшита: drawImage з прямокутником-джерелом (sx, sy, sw, sh).
// Кадри йдуть в один рядок, кожен frameSize x frameSize, носом вправо.
function drawSprite(ctx: Ctx, sprites: Sprites, frame: string, x: number, y: number, angle: number, size: number): void {
  const index = sprites.frames.indexOf(frame);
  if (index === -1) return; // такого кадру в маніфесті немає
  const fs = sprites.frameSize;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(sprites.image, index * fs, 0, fs, fs, -size / 2, -size / 2, size, size);
  ctx.restore();
}

// ---------- запасні фігури, якщо спрайти не завантажились ----------

// Корабель малюємо в точці (0, 0) носом вправо, а translate/rotate ставлять його на місце
function drawShipShape(ctx: Ctx, ship: Drawable): void {
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  if (ship.thrust) {
    const flame = 14 + Math.random() * 8;
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.moveTo(-10, -5);
    ctx.lineTo(-10 - flame, 0);
    ctx.lineTo(-10, 5);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = ship.mine ? '#c9d6ff' : '#ffd0c9';
  ctx.strokeStyle = ship.mine ? '#5b6cff' : '#ff6b5b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-12, -12);
  ctx.lineTo(-7, 0);
  ctx.lineTo(-12, 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// форма астероїда з його id: у всіх гравців однакова, і по мережі її передавати не треба
function asteroidShape(id: EntityId): number[] {
  const rnd = mulberry32(id * 7919);
  const shape: number[] = [];
  for (let i = 0; i < 10; i++) shape.push(0.75 + rnd() * 0.35);
  return shape;
}

function drawAsteroidShape(ctx: Ctx, a: Drawable): void {
  const radius = a.big ? 30 : 15;
  const shape = asteroidShape(a.id);
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(a.angle);
  ctx.fillStyle = '#2a2d3a';
  ctx.strokeStyle = a.hunter ? '#ff5a5a' : '#9aa0b5'; // мисливці червоні
  ctx.lineWidth = 2;
  ctx.beginPath();
  shape.forEach((m, i) => {
    const ang = (i / shape.length) * Math.PI * 2;
    if (i === 0) ctx.moveTo(Math.cos(ang) * radius * m, Math.sin(ang) * radius * m);
    else ctx.lineTo(Math.cos(ang) * radius * m, Math.sin(ang) * radius * m);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawBulletShape(ctx: Ctx, b: Drawable): void {
  ctx.fillStyle = b.missile ? '#ff7b3a' : '#fff6a0';
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.missile ? 5 : 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawPickupShape(ctx: Ctx, p: Drawable): void {
  const isShield = p.effect === 'shield';
  ctx.save();
  ctx.strokeStyle = isShield ? '#78dcff' : '#c78bff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isShield ? 'S' : '3', p.x, p.y);
  ctx.restore();
}

function drawShield(ctx: Ctx, ship: Drawable): void {
  ctx.strokeStyle = 'rgba(120, 220, 255, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ship.x, ship.y, 22, 0, Math.PI * 2);
  ctx.stroke();
}

function drawName(ctx: Ctx, ship: Drawable, name: string | undefined): void {
  if (!name) return;
  ctx.save();
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = ship.mine ? '#9dff9d' : '#ffb0a8';
  ctx.fillText(name, ship.x, ship.y + 32);
  ctx.restore();
}

// list - з NetClient.renderList(), names - Map shipId -> ім'я
export function drawWorld(ctx: Ctx, list: readonly Drawable[], sprites: Sprites | null, names: ReadonlyMap<EntityId, string>): void {
  for (const e of list) {
    switch (e.kind) {
      case 'ship':
        if (e.dead) break;
        if (sprites) drawSprite(ctx, sprites, e.thrust ? 'ship_thrust' : 'ship', e.x, e.y, e.angle, 44);
        else drawShipShape(ctx, e);
        if (e.shield) drawShield(ctx, e);
        drawName(ctx, e, names.get(e.id));
        break;
      case 'bullet':
        if (sprites) drawSprite(ctx, sprites, e.missile ? 'missile' : 'bullet', e.x, e.y, e.angle, e.missile ? 26 : 10);
        else drawBulletShape(ctx, e);
        break;
      case 'asteroid': {
        // готові рядки замість 'rock_' + 'big' у кожному кадрі
        const frame = e.hunter ? (e.big ? 'hunter_big' : 'hunter_small') : e.big ? 'rock_big' : 'rock_small';
        if (sprites) drawSprite(ctx, sprites, frame, e.x, e.y, e.angle, e.big ? 66 : 33);
        else drawAsteroidShape(ctx, e);
        break;
      }
      case 'pickup':
        if (sprites) drawSprite(ctx, sprites, e.effect === 'shield' ? 'pickup_shield' : 'pickup_triple', e.x, e.y, 0, 30);
        else drawPickupShape(ctx, e);
        break;
      default:
        assertNever(e.kind);
    }
  }
}

// ---------- вибухи (лише на клієнті, по подіях сервера) ----------

// Частинки живуть у пулі (particles.ts): вибух не створює нових об'єктів.
export function drawParticles(ctx: Ctx, pool: ParticlePool, dt: number): void {
  pool.update(dt);
  ctx.save();
  for (let i = 0; i < pool.active; i++) {
    const p = pool.items[i];
    if (!p) break;
    ctx.globalAlpha = p.life > 0 ? p.life : 0;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  ctx.restore();
}

export function drawHud(ctx: Ctx, lines: readonly string[]): void {
  ctx.save();
  ctx.font = '14px monospace';
  const lineHeight = 18;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(10, 10, 450, lines.length * lineHeight + 14);

  ctx.fillStyle = '#9dff9d';
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i] ?? '', 20, 30 + i * lineHeight);
  ctx.restore();
}

// Екран завантаження: справжній прогрес (скільки файлів уже готово) і список файлів
export interface LoadingState {
  title: string;
  progress: number;
  lines: string[];
  failed: boolean;
}

export function drawLoading(ctx: Ctx, width: number, height: number, state: LoadingState): void {
  ctx.fillStyle = '#05060f';
  ctx.fillRect(0, 0, width, height);

  const barW = Math.min(500, width - 80);
  const x = (width - barW) / 2;
  const y = height / 2 - 60;

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(state.title, width / 2, y - 24);

  ctx.strokeStyle = '#5b6cff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, barW, 22);
  ctx.fillStyle = state.failed ? '#ff5a5a' : '#5b6cff';
  ctx.fillRect(x + 3, y + 3, (barW - 6) * state.progress, 16);

  ctx.font = '14px monospace';
  ctx.textAlign = 'left';
  state.lines.forEach((line, i) => {
    ctx.fillStyle = line.startsWith('✗') ? '#ff8a8a' : '#9dff9d';
    ctx.fillText(line, x, y + 50 + i * 20);
  });
  ctx.textAlign = 'start';
}
