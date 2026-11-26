import type { FromWorker, ToWorker } from './particles.worker.ts';

// Головний потік для варіанту "частинки у воркері". Два буфери: один у нас (з нього малюємо),
// другий у воркера. Коли воркер повертає свій - міняємо їх місцями.
const COLORS = ['#ffb347', '#8fa2ff'];
const SIZE = 4000 * 4;

export class ParticlesInWorker {
  readonly #worker: Worker;
  #drawBuf: Float32Array<ArrayBuffer> = new Float32Array(SIZE);
  #spare: Float32Array<ArrayBuffer> | null = new Float32Array(SIZE); // null - буфер зараз у воркера
  #count = 0;
  #pendingDt = 0;

  constructor() {
    this.#worker = new Worker(new URL('./particles.worker.ts', import.meta.url), { type: 'module' });
    this.#worker.onmessage = (event: MessageEvent<FromWorker>) => {
      this.#spare = this.#drawBuf;
      this.#drawBuf = event.data.buffer;
      this.#count = event.data.count;
    };
  }

  explode(x: number, y: number, count: number, color: string): void {
    const msg: ToWorker = { type: 'explode', x, y, count, color: color === '#8fa2ff' ? 1 : 0 };
    this.#worker.postMessage(msg);
  }

  // кожен кадр: віддати воркеру dt (якщо наш буфер повернувся) і намалювати останнє, що він прислав
  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    this.#pendingDt += dt;
    if (this.#spare) {
      const msg: ToWorker = { type: 'frame', dt: this.#pendingDt, buffer: this.#spare };
      this.#worker.postMessage(msg, [this.#spare.buffer]);
      this.#spare = null;
      this.#pendingDt = 0;
    }
    const b = this.#drawBuf;
    ctx.save();
    for (let i = 0; i < this.#count; i++) {
      const life = b[i * 4 + 2] ?? 0;
      ctx.globalAlpha = life > 0 ? life : 0;
      ctx.fillStyle = COLORS[b[i * 4 + 3] ?? 0] ?? '#ffb347';
      ctx.fillRect((b[i * 4] ?? 0) - 1.5, (b[i * 4 + 1] ?? 0) - 1.5, 3, 3);
    }
    ctx.restore();
  }
}
