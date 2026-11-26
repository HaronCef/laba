// Рахунок на екрані. Як і audio.js, слухає події світу, а симуляція його не імпортує.

export function createHud(world) {
  let score = 0;
  let popups = []; // написи "+100", що злітають вгору: { text, x, y, born }

  world.addEventListener('score', (e) => {
    score = e.detail.score;
    popups.push({
      text: `+${e.detail.delta}`,
      x: e.detail.pos.x,
      y: e.detail.pos.y,
      born: performance.now(),
    });
  });

  function draw(ctx, width) {
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

    ctx.globalAlpha = 1;
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffe27a';
    ctx.fillText(`SCORE ${score}`, width - 20, 36);
    ctx.restore();
  }

  return { draw };
}
