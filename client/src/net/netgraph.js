// Netgraph - панель з цифрами мережі в правому верхньому куті.
// Клавіші: P - прогноз вкл/викл, [ і ] - затримка інтерполяції, N - штучна погана мережа,
//          B - зламати детермінізм (Math.random() в integrate, лише на клієнті)

import { setBreakDeterminism } from 'shared/sim/ship.js';

// штучна мережа: lag - туди-назад, jitter - розкид, drop - частка загублених пакетів
const NETSIM_PRESETS = [
  { name: 'вимк.', lag: 0, jitter: 0, drop: 0 },
  { name: '100±30 мс, 2%', lag: 100, jitter: 30, drop: 0.02 },
  { name: '150±30 мс, 5%', lag: 150, jitter: 30, drop: 0.05 },
  { name: '100 мс, 0%', lag: 100, jitter: 0, drop: 0 },
];

export function findPreset(net) {
  const i = NETSIM_PRESETS.findIndex(
    (p) => p.lag === net.lag && p.jitter === net.jitter && p.drop === net.drop,
  );
  return i === -1 ? 0 : i;
}

export function createNetgraph(net, connection, { initialPreset = 0 } = {}) {
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
      const { lag, jitter, drop } = NETSIM_PRESETS[preset];
      connection.send('netsim', { lag, jitter, drop });
    }
    if (e.code === 'KeyB') {
      broken = !broken;
      setBreakDeterminism(broken);
    }
  });

  function draw(ctx, right, top) {
    const now = performance.now();
    const recent = net.corrections.slice(-30);
    const maxCorr = recent.length ? Math.max(...recent) : 0;
    const age = net.latest ? now - net.latest.arrival : 0;

    const lines = [
      `RTT:           ${Math.round(net.rtt)} мс`,
      `знімок віком:  ${Math.round(age)} мс (tick ${net.latest?.tick ?? '-'})`,
      `вхід / вихід:  ${(inPerSec / 1024).toFixed(1)} / ${(outPerSec / 1024).toFixed(1)} КБ/с`,
      `input у черзі: ${net.pending.length}`,
      `поправка:      ${net.lastCorrection.toFixed(2)} px (макс за 1 с ${maxCorr.toFixed(2)})`,
      `інтерполяція:  ${net.interpDelay} мс  [ ]`,
      `прогноз:       ${net.predict ? 'УВІМК' : 'вимк'}  P`,
      `мережа:        ${NETSIM_PRESETS[preset].name}  N`,
      `кодек:         ${net.codec}${broken ? '   Math.random: ТАК (B)' : ''}`,
    ];

    const width = 330;
    const left = right - width;
    const graphH = 40;
    const height = lines.length * 16 + graphH + 20;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(left, top, width, height);
    ctx.font = '12px monospace';
    ctx.fillStyle = broken ? '#ffb0b0' : '#9dd8ff';
    lines.forEach((line, i) => ctx.fillText(line, left + 8, top + 16 + i * 16));

    // графік поправок за останні 3 с (стовпчик на кожен знімок, шкала до 20 px)
    const gy = top + lines.length * 16 + 10;
    ctx.strokeStyle = '#334';
    ctx.strokeRect(left + 8, gy, width - 16, graphH);
    const list = net.corrections;
    const barW = (width - 16) / 90;
    list.forEach((c, i) => {
      const h = Math.min(graphH, (c / 20) * graphH);
      ctx.fillStyle = c > 5 ? '#ff6b6b' : '#7dff9a';
      ctx.fillRect(left + 8 + i * barW, gy + graphH - h, Math.max(1, barW - 0.5), h);
    });
    ctx.restore();
  }

  return { draw };
}
