// Canvas з урахуванням devicePixelRatio: реальних пікселів у dpr разів більше,
// а малюємо ми в CSS-пікселях завдяки ctx.scale(dpr, dpr).

export interface Size {
  width: number;
  height: number;
}

export function setupCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; size: Size } {
  // getContext може повернути null (наприклад, контекст уже іншого типу) - TypeScript не дає це пропустити
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D недоступний');
  const size: Size = { width: 0, height: 0 };

  // стрілка в const, а не function: TypeScript пам'ятає, що ctx уже перевірено на null
  // (function "піднімається" вгору, і для неї перевірка ще не відбулась)
  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    size.width = canvas.clientWidth;
    size.height = canvas.clientHeight;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    // після зміни canvas.width трансформація скидається, тому задаємо знову
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  resize();
  window.addEventListener('resize', resize);
  return { ctx, size };
}
