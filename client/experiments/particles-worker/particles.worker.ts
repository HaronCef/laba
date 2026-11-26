// Експеримент лаби 7: частинки рахуються у Web Worker, а не в головному потоці.
// Стан частинок живе тут. Кожен кадр головний потік надсилає dt і порожній буфер
// (transferable - передається без копіювання), ми оновлюємо частинки, пишемо в буфер
// x, y, life, колір і віддаємо буфер назад теж як transferable.

export type ToWorker =
  | { type: 'explode'; x: number; y: number; count: number; color: number }
  | { type: 'frame'; dt: number; buffer: Float32Array<ArrayBuffer> };

export type FromWorker = { type: 'frame'; buffer: Float32Array<ArrayBuffer>; count: number };

export const FLOATS_PER_PARTICLE = 4; // x, y, life, номер кольору

const MAX = 4000;
const px = new Float32Array(MAX);
const py = new Float32Array(MAX);
const vx = new Float32Array(MAX);
const vy = new Float32Array(MAX);
const life = new Float32Array(MAX);
const color = new Float32Array(MAX);
let active = 0;

function explode(x: number, y: number, count: number, c: number): void {
  for (let i = 0; i < count && active < MAX; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 160;
    px[active] = x;
    py[active] = y;
    vx[active] = Math.cos(angle) * speed;
    vy[active] = Math.sin(angle) * speed;
    life[active] = 1;
    color[active] = c;
    active++;
  }
}

function update(dt: number): void {
  let i = 0;
  while (i < active) {
    const l = (life[i] ?? 0) - dt / 0.8;
    if (l <= 0) {
      // догоріла - на її місце остання жива
      active--;
      px[i] = px[active] ?? 0;
      py[i] = py[active] ?? 0;
      vx[i] = vx[active] ?? 0;
      vy[i] = vy[active] ?? 0;
      life[i] = life[active] ?? 0;
      color[i] = color[active] ?? 0;
      continue;
    }
    life[i] = l;
    px[i] = (px[i] ?? 0) + (vx[i] ?? 0) * dt;
    py[i] = (py[i] ?? 0) + (vy[i] ?? 0) * dt;
    i++;
  }
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  if (msg.type === 'explode') {
    explode(msg.x, msg.y, msg.count, msg.color);
    return;
  }
  update(msg.dt);
  const out = msg.buffer;
  const count = Math.min(active, out.length / FLOATS_PER_PARTICLE);
  for (let i = 0; i < count; i++) {
    out[i * 4] = px[i] ?? 0;
    out[i * 4 + 1] = py[i] ?? 0;
    out[i * 4 + 2] = life[i] ?? 0;
    out[i * 4 + 3] = color[i] ?? 0;
  }
  const reply: FromWorker = { type: 'frame', buffer: out, count };
  self.postMessage(reply, { transfer: [out.buffer] });
};
