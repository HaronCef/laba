import { normalizeAngle } from '../sim/vector.js';
import { wrapValue } from '../sim/arena.js';

// Різницю кутів спочатку приводимо до [-PI, PI), щоб корабель
// повертався коротким шляхом, а не робив повне коло через -PI/PI.
function lerpAngle(a, b, t) {
  const diff = normalizeAngle(b - a);
  return a + diff * t;
}

// Якщо між кроками сутність перелетіла через край, різниця координат буде
// майже на всю ширину арени. Тоді беремо короткий шлях "через край".
function lerpWrapped(a, b, t, max) {
  let diff = b - a;
  if (diff > max / 2) diff -= max;
  if (diff < -max / 2) diff += max;
  return wrapValue(a + diff * t, max);
}

// де малювати сутність між попереднім і поточним кроком
function interpolate(entity, alpha, arena) {
  return {
    x: lerpWrapped(entity.prevPos.x, entity.pos.x, alpha, arena.width),
    y: lerpWrapped(entity.prevPos.y, entity.pos.y, alpha, arena.height),
    angle: lerpAngle(entity.prevAngle, entity.angle, alpha),
  };
}

// Малює кадр зі спрайтшита: drawImage з прямокутником-джерелом (sx, sy, sw, sh).
// Кадри йдуть в один рядок, кожен frameSize x frameSize, носом вправо.
function drawSprite(ctx, sprites, frame, p, size) {
  const index = sprites.frames.indexOf(frame);
  const fs = sprites.frameSize;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.drawImage(sprites.image, index * fs, 0, fs, fs, -size / 2, -size / 2, size, size);
  ctx.restore();
}

// Зірки зберігаємо у відносних координатах (0..1), щоб при зміні розміру
// вікна вони не збивались в один кут.
export function createStars(count) {
  const stars = [];
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

export function drawBackground(ctx, width, height, stars) {
  ctx.fillStyle = '#05060f';
  ctx.fillRect(0, 0, width, height);

  for (const star of stars) {
    ctx.fillStyle = `rgba(255, 255, 255, ${star.bright})`;
    ctx.beginPath();
    ctx.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Корабель малюємо в точці (0, 0) носом вправо, а translate/rotate ставлять його на місце
function drawShip(ctx, ship, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);

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

  // корпус
  ctx.fillStyle = '#c9d6ff';
  ctx.strokeStyle = '#5b6cff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-12, -12);
  ctx.lineTo(-7, 0);
  ctx.lineTo(-12, 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // кабіна
  ctx.fillStyle = '#5b6cff';
  ctx.beginPath();
  ctx.arc(3, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // щит
  if (ship.effects.shield > 0) {
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(0, 0, ship.radius + 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawBullet(ctx, bullet, p) {
  ctx.fillStyle = bullet.homing ? '#ff7b3a' : '#fff6a0';
  ctx.beginPath();
  ctx.arc(p.x, p.y, bullet.radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawAsteroid(ctx, asteroid, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.fillStyle = '#2a2d3a';
  ctx.strokeStyle = asteroid.homing ? '#ff5a5a' : '#9aa0b5'; // мисливці червоні
  ctx.lineWidth = 2;
  ctx.beginPath();
  const n = asteroid.shape.length;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = asteroid.radius * asteroid.shape[i];
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPickup(ctx, pickup, p) {
  const isShield = pickup.pickup.effect === 'shield';
  ctx.save();
  ctx.strokeStyle = isShield ? '#78dcff' : '#c78bff';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, pickup.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isShield ? 'S' : '3', p.x, p.y);
  ctx.restore();
}

function drawExplosion(ctx, explosion) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, explosion.life);
  ctx.fillStyle = explosion.color;
  for (const part of explosion.particles) {
    ctx.fillRect(part.pos.x - 1.5, part.pos.y - 1.5, 3, 3);
  }
  ctx.restore();
}

function drawShield(ctx, ship, p) {
  ctx.strokeStyle = 'rgba(120, 220, 255, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, ship.radius + 8, 0, Math.PI * 2);
  ctx.stroke();
}

// зі спрайтами
function drawWithSprites(ctx, sprites, entity, p) {
  switch (entity.kind) {
    case 'ship':
      if (entity.isDead) return;
      drawSprite(ctx, sprites, entity.thrust ? 'ship_thrust' : 'ship', p, 44);
      if (entity.effects.shield > 0) drawShield(ctx, entity, p);
      break;
    case 'bullet':
      if (entity.homing) drawSprite(ctx, sprites, 'missile', p, 26);
      else drawSprite(ctx, sprites, 'bullet', p, 10);
      break;
    case 'asteroid': {
      const big = entity.size === 2;
      const frame = (entity.homing ? 'hunter_' : 'rock_') + (big ? 'big' : 'small');
      drawSprite(ctx, sprites, frame, p, entity.radius * 2.2);
      break;
    }
    case 'pickup':
      drawSprite(ctx, sprites, `pickup_${entity.pickup.effect}`, { ...p, angle: 0 }, 30);
      break;
    case 'explosion':
      drawExplosion(ctx, entity);
      break;
  }
}

// sprites = null, якщо спрайтшит не завантажився - тоді малюємо фігурами, як у лабі 2
export function drawWorld(ctx, world, alpha, sprites) {
  for (const entity of world) {
    const p = interpolate(entity, alpha, world.arena);
    if (sprites) {
      drawWithSprites(ctx, sprites, entity, p);
      continue;
    }
    switch (entity.kind) {
      case 'ship':
        if (!entity.isDead) drawShip(ctx, entity, p);
        break;
      case 'bullet':
        drawBullet(ctx, entity, p);
        break;
      case 'asteroid':
        drawAsteroid(ctx, entity, p);
        break;
      case 'pickup':
        drawPickup(ctx, entity, p);
        break;
      case 'explosion':
        drawExplosion(ctx, entity);
        break;
    }
  }
}

export function drawHud(ctx, lines) {
  ctx.save();
  ctx.font = '14px monospace';
  const lineHeight = 18;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(10, 10, 450, lines.length * lineHeight + 14);

  ctx.fillStyle = '#9dff9d';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 20, 30 + i * lineHeight);
  }
  ctx.restore();
}

// Екран завантаження: справжній прогрес (скільки файлів уже готово) і список файлів
export function drawLoading(ctx, width, height, state) {
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
