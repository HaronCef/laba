// Netgraph - панель з цифрами мережі в правому верхньому куті.
// Клавіші: P - прогноз вкл/викл, [ і ] - затримка інтерполяції, N - штучна погана мережа,
//          B - зламати детермінізм (Math.random() в integrate, лише на клієнті)

import { setBreakDeterminism } from 'shared/sim/ship.ts';
import type { Netsim } from 'shared/protocol.ts';
import type { NetClient } from './netclient.ts';
import type { Connection } from './connection.ts';

interface Preset extends Netsim {
  readonly name: string;
}

// штучна мережа: lag - туди-назад, jitter - розкид, drop - частка загублених пакетів
const NETSIM_PRESETS: readonly Preset[] = [
  { name: 'вимк.', lag: 0, jitter: 0, drop: 0 },
  { name: '100±30 мс, 2%', lag: 100, jitter: 30, drop: 0.02 },
  { name: '150±30 мс, 5%', lag: 150, jitter: 30, drop: 0.05 },
  { name: '100 мс, 0%', lag: 100, jitter: 0, drop: 0 },
];

export function findPreset(net: Netsim): number {
  const i = NETSIM_PRESETS.findIndex((p) => p.lag === net.lag && p.jitter === net.jitter && p.drop === net.drop);
  return i === -1 ? 0 : i;
}

export function createNetgraph(net: NetClient, connection: Connection, { initialPreset = 0 } = {}) {
  let preset = initialPreset;
  let broken = false;
  let lastBytesIn = 0;
  let lastBytesOut = 0;
  let inPerSec = 0;
  let outPerSec = 0;

  setInterval(() => {
    inPerSec = connection.bytesIn - lastBytesIn;
    outPerSec = connection.bytesOut - lastBytesOut;
    lastBytesIn = connection.bytesIn;
    lastBytesOut = connection.bytesOut;
  }, 1000);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP') net.predict = !net.predict;
    if (e.code === 'BracketLeft') net.interpDelay = Math.max(0, net.interpDelay - 17);
    if (e.code === 'BracketRight') net.interpDelay = Math.min(300, net.interpDelay + 17);
    if (e.code === 'KeyN') {
      preset = (preset + 1) % NETSIM_PRESETS.length;
      // у JS тут було NETSIM_PRESETS[preset].lag - TypeScript нагадав, що індекс може промахнутись
      const next = NETSIM_PRESETS[preset];
      if (next) connection.send({ type: 'netsim', lag: next.lag, jitter: next.jitter, drop: next.drop });
    }
    if (e.code === 'KeyB') {
      broken = !broken;
      setBreakDeterminism(broken);
    }
  });

  // текст оновлюємо 4 рази на секунду, а не кожен кадр
  let lines: string[] = [];
  let linesAt = -Infinity;

  function updateLines(now: number): void {
    let maxCorr = 0;
    const from = Math.max(0, net.corrections.length - 30);
    for (let i = from; i < net.corrections.length; i++) maxCorr = Math.max(maxCorr, net.corrections[i] ?? 0);
    const age = net.latest ? now - net.latest.arrival : 0;

    lines = [
      `RTT:           ${Math.round(net.rtt)} мс`,
      `знімок віком:  ${Math.round(age)} мс (tick ${net.latest?.tick ?? '-'})`,
      `вхід / вихід:  ${(inPerSec / 1024).toFixed(1)} / ${(outPerSec / 1024).toFixed(1)} КБ/с`,
      `input у черзі: ${net.pending.length}`,
      `поправка:      ${net.lastCorrection.toFixed(2)} px (макс за 1 с ${maxCorr.toFixed(2)})`,
      `інтерполяція:  ${net.interpDelay} мс  [ ]`,
      `прогноз:       ${net.predict ? 'УВІМК' : 'вимк'}  P`,
      `мережа:        ${NETSIM_PRESETS[preset]?.name ?? '?'}  N`,
      `кодек:         ${net.codec.name}${broken ? '   Math.random: ТАК (B)' : ''}`,
    ];
  }

  function draw(ctx: CanvasRenderingContext2D, right: number, top: number): void {
    const now = performance.now();
    if (now - linesAt > 250) {
      updateLines(now);
      linesAt = now;
    }

    const width = 330;
    const left = right - width;
    const graphH = 40;
    const height = lines.length * 16 + graphH + 20;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(left, top, width, height);
    ctx.font = '12px monospace';
    ctx.fillStyle = broken ? '#ffb0b0' : '#9dd8ff';
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i] ?? '', left + 8, top + 16 + i * 16);

    // графік поправок за останні 3 с (стовпчик на кожен знімок, шкала до 20 px)
    const gy = top + lines.length * 16 + 10;
    ctx.strokeStyle = '#334';
    ctx.strokeRect(left + 8, gy, width - 16, graphH);
    const barW = (width - 16) / 90;
    for (let i = 0; i < net.corrections.length; i++) {
      const c = net.corrections[i] ?? 0;
      const h = Math.min(graphH, (c / 20) * graphH);
      ctx.fillStyle = c > 5 ? '#ff6b6b' : '#7dff9a';
      ctx.fillRect(left + 8 + i * barW, gy + graphH - h, Math.max(1, barW - 0.5), h);
    }
    ctx.restore();
  }

  return { draw };
}
