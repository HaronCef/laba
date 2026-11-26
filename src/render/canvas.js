// Canvas з урахуванням devicePixelRatio: реальних пікселів у dpr разів більше,
// а малюємо ми в CSS-пікселях завдяки ctx.scale(dpr, dpr).

export function setupCanvas(canvas, onResize) {
  const ctx = canvas.getContext('2d');
  const size = { width: 0, height: 0 };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    size.width = canvas.clientWidth;
    size.height = canvas.clientHeight;

    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);

    // після зміни canvas.width трансформація скидається, тому задаємо знову
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    if (onResize) onResize(size.width, size.height);
  }

  resize();
  window.addEventListener('resize', resize);

  return { ctx, size };
}
