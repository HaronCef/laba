import { mulberry32 } from 'shared/rng.js';

// Малювання. Світ тепер рахує сервер, тому тут на вхід ідуть не сутності,
// а прості об'єкти з NetClient.renderList(): { kind, x, y, angle, ... } у координатах арени.

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

// Арена однакова для всіх (1280x720), тому вписуємо її у вікно
export function arenaView(width, height, arena) {
  const scale = Math.min(width / arena.width, height / arena.height);
  return {
    scale,
    x: (width - arena.width * scale) / 2,
    y: (height - arena.height * scale) / 2,
  };
}

// Кадр зі спрайтшита: drawImage з прямокутником-джерелом (sx, sy, sw, sh).
// Кадри йдуть в один рядок, кожен frameSize x frameSize, носом вправо.
function drawSprite(ctx, sprites, frame, e, size) {
  const index = sprites.frames.indexOf(frame);
  const fs = sprites.frameSize;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.angle);
  ctx.drawImage(sprites.image, index * fs, 0, fs, fs, -size / 2, -size / 2, size, size);
  ctx.restore();
}

// ---------- запасні фігури, якщо спрайти не завантажились ----------

// Корабель малюємо в точці (0, 0) носом вправо, а translate/rotate ставлять його на місце
function drawShipShape(ctx, ship) {
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
function asteroidShape(id) {
  const rnd = mulberry32(id * 7919);
  const shape = [];
  for (let i = 0; i < 10; i++) shape.push(0.75 + rnd() * 0.35);
  return shape;
}

function drawAsteroidShape(ctx, a) {
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

function drawBulletShape(ctx, b) {
  ctx.fillStyle = b.missile ? '#ff7b3a' : '#fff6a0';
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.missile ? 5 : 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawPickupShape(ctx, p) {
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

function drawShield(ctx, ship) {
  ctx.strokeStyle = 'rgba(120, 220, 255, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ship.x, ship.y, 22, 0, Math.PI * 2);
  ctx.stroke();
}

function drawName(ctx, ship, name) {
  if (!name) return;
  ctx.save();
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = ship.mine ? '#9dff9d' : '#ffb0a8';
  ctx.fillText(name, ship.x, ship.y + 32);
  ctx.restore();
}

// list - з NetClient.renderList(), names - Map shipId -> ім'я
export function drawWorld(ctx, list, sprites, names) {
  for (const e of list) {
    if (e.kind === 'ship') {
      if (e.dead) continue;
      if (sprites) drawSprite(ctx, sprites, e.thrust ? 'ship_thrust' : 'ship', e, 44);
      else drawShipShape(ctx, e);
      if (e.shield) drawShield(ctx, e);
      drawName(ctx, e, names.get(e.id));
    } else if (e.kind === 'bullet') {
      if (sprites)
        drawSprite(
          ctx,
          sprites,
          e.missile ? 'missile' : 'bullet',
          e,
          e.missile ? 26 : 10,
        );
      else drawBulletShape(ctx, e);
    } else if (e.kind === 'asteroid') {
      const frame = (e.hunter ? 'hunter_' : 'rock_') + (e.big ? 'big' : 'small');
      if (sprites) drawSprite(ctx, sprites, frame, e, e.big ? 66 : 33);
      else drawAsteroidShape(ctx, e);
    } else if (e.kind === 'pickup') {
      if (sprites) drawSprite(ctx, sprites, `pickup_${e.effect}`, { ...e, angle: 0 }, 30);
      else drawPickupShape(ctx, e);
    }
  }
}

// ---------- вибухи (лише на клієнті, по подіях сервера) ----------

export function createExplosion(x, y, count, color = '#ffb347') {
  const particles = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 160;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
  }
  return { particles, color, life: 1 };
}

// оновлює і малює; повертає лише ті, що ще не догоріли
export function drawExplosions(ctx, explosions, dt) {
  for (const ex of explosions) {
    ex.life -= dt / 0.8;
    ctx.save();
    ctx.globalAlpha = Math.max(0, ex.life);
    ctx.fillStyle = ex.color;
    for (const p of ex.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.restore();
  }
  return explosions.filter((ex) => ex.life > 0);
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
