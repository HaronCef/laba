import { normalizeAngle } from '../sim/ship.js';
import { wrapValue } from '../sim/arena.js';


function lerpAngle(a, b, t) {
  const diff = normalizeAngle(b - a);
  return a + diff * t;
}

function lerpWrapped(a, b, t, max) {
  let diff = b - a;
  if (diff > max / 2) diff -= max;
  if (diff < -max / 2) diff += max;
  return wrapValue(a + diff * t, max);
}

export function interpolateShip(prev, curr, alpha, arena) {
  return {
    x: lerpWrapped(prev.x, curr.x, alpha, arena.width),
    y: lerpWrapped(prev.y, curr.y, alpha, arena.height),
    angle: lerpAngle(prev.angle, curr.angle, alpha),
    thrust: curr.thrust,
  };
}


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


export function drawShip(ctx, ship) {
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


  ctx.fillStyle = '#5b6cff';
  ctx.beginPath();
  ctx.arc(3, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
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
