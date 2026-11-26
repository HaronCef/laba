// Рахунок на екрані. Слухає події 'score' від NetClient (їх присилає сервер)
// і показує лише свої очки.

export function createHud(net) {
  let score = 0;
  let popups = []; // написи "+100", що злітають вгору: { text, x, y, born }

  net.addEventListener('score', (e) => {
    if (e.detail.ship !== net.shipId) return;
    score = e.detail.score;
    popups.push({
      text: `+${e.detail.delta}`,
      x: e.detail.x,
      y: e.detail.y,
      born: performance.now(),
    });
  });
  net.addEventListener('joined', () => {
    score = 0; // новий корабель після перепідключення
  });

  // написи малюються в координатах арени (всередині її transform)
  function drawPopups(ctx) {
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

  function drawScore(ctx, width) {
    ctx.save();
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffe27a';
    ctx.fillText(`SCORE ${score}`, width - 20, 36);
    ctx.restore();
  }

  return { drawPopups, drawScore };
}
