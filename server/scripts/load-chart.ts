// Малює графік load test (p99 кроку від кількості гравців) у docs/load/chart.svg.
// npm run load-chart --workspace=server   (бере docs/load/before.json і after.json)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

interface Row {
  n: number;
  tickP99: number;
}

const dir = path.resolve(import.meta.dirname, '../../docs/load');
const read = (name: string): Row[] => {
  const file = path.join(dir, name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Row[]) : [];
};
const series = [
  { name: 'до оптимізацій', color: '#f47230', rows: read('before.json') },
  { name: 'після оптимізацій', color: '#257de0', rows: read('after.json') },
];

const W = 760;
const H = 420;
const left = 60;
const right = 220;
const top = 40;
const bottom = 60;
const maxN = 1024;
const maxY = 60;
// по X - log2 (8, 16, ... 1024), бо N росте вдвічі
const x = (n: number): number => left + ((Math.log2(n) - 3) / (Math.log2(maxN) - 3)) * (W - left - right);
const y = (ms: number): number => top + (1 - ms / maxY) * (H - top - bottom);

const parts: string[] = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="sans-serif" font-size="12">`);
parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
parts.push(`<text x="${left}" y="22" font-size="15" font-weight="bold" fill="#191919">Тривалість кроку сервера (p99) від кількості гравців в одній кімнаті</text>`);
// сітка і осі
for (let ms = 0; ms <= maxY; ms += 10) {
  parts.push(`<line x1="${left}" x2="${W - right}" y1="${y(ms)}" y2="${y(ms)}" stroke="#e6e6e6"/>`);
  parts.push(`<text x="${left - 8}" y="${y(ms) + 4}" text-anchor="end" fill="#666666">${ms}</text>`);
}
for (let n = 8; n <= maxN; n *= 2) {
  parts.push(`<text x="${x(n)}" y="${H - bottom + 18}" text-anchor="middle" fill="#666666">${n}</text>`);
}
parts.push(`<text x="${(left + W - right) / 2}" y="${H - 18}" text-anchor="middle" fill="#666666">гравців (N), шкала log2</text>`);
parts.push(`<text transform="translate(16 ${(top + H - bottom) / 2}) rotate(-90)" text-anchor="middle" fill="#666666">мс</text>`);
// межа 33 мс (один крок при 30 Гц)
parts.push(`<line x1="${left}" x2="${W - right}" y1="${y(33.3)}" y2="${y(33.3)}" stroke="#191919" stroke-dasharray="5 4"/>`);
parts.push(`<text x="${W - right + 6}" y="${y(33.3) + 4}" fill="#191919">33 мс = бюджет кроку</text>`);

series.forEach((s, i) => {
  if (s.rows.length === 0) return;
  const pts = s.rows.map((r) => `${x(r.n).toFixed(1)},${y(r.tickP99).toFixed(1)}`).join(' ');
  parts.push(`<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2"/>`);
  for (const r of s.rows) {
    parts.push(`<circle cx="${x(r.n)}" cy="${y(r.tickP99)}" r="4.5" fill="${s.color}" stroke="#ffffff" stroke-width="2"><title>N=${r.n}: ${r.tickP99} мс</title></circle>`);
  }
  // легенда справа
  const ly = top + 20 + i * 22;
  parts.push(`<line x1="${W - right + 6}" x2="${W - right + 26}" y1="${ly + 70}" y2="${ly + 70}" stroke="${s.color}" stroke-width="2"/>`);
  parts.push(`<circle cx="${W - right + 16}" cy="${ly + 70}" r="4" fill="${s.color}"/>`);
  parts.push(`<text x="${W - right + 32}" y="${ly + 74}" fill="#191919">${s.name.length > 22 ? s.name.slice(0, 22) + '…' : s.name}</text>`);
  // підпис останньої точки
  const last = s.rows[s.rows.length - 1];
  if (last) parts.push(`<text x="${x(last.n) + 8}" y="${y(last.tickP99) - 8}" fill="#191919">${last.tickP99} мс</text>`);
});
parts.push('</svg>');
writeFileSync(path.join(dir, 'chart.svg'), parts.join('\n'));
console.log('збережено', path.join(dir, 'chart.svg'));
