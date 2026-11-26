import type { NetClient } from './net/netclient.ts';

// Рахунок на екрані. Слухає події 'score' від NetClient (їх присилає сервер)
// і показує лише свої очки.

interface Popup {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly born: number;
}

export function createHud(net: NetClient) {
  let score = 0;
  let popups: Popup[] = []; // написи "+100", що злітають вгору

  net.on('score', (e) => {
    if (e.ship !== net.shipId) return;
    score = e.score;
    popups.push({ text: `+${e.delta}`, x: e.x, y: e.y, born: performance.now() });
  });
  net.on('joined', () => {
    score = 0; // новий корабель після перепідключення
  });

  // написи малюються в координатах арени (всередині її transform)
  function drawPopups(ctx: CanvasRenderingContext2D): void {
    const now = performance.now();
    popups = popups.filter((p) => now - p.born < 800);
    ctx.save();
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    for (const p of popups) {
      const age = (now - p.born) / 800; // від 0 до 1
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = '#ffe27a';
      ctx.fillText(p.text, p.x, p.y - age * 30);
    }
    ctx.restore();
  }

  function drawScore(ctx: CanvasRenderingContext2D, width: number): void {
    ctx.save();
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffe27a';
    ctx.fillText(`SCORE ${score}`, width - 20, 36);
    ctx.restore();
  }

  return { drawPopups, drawScore };
}
