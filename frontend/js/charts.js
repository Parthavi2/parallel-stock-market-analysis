// Tiny dependency-free SVG charts (bar + line). Only plots numbers it is given;
// null values are skipped, never invented.
const W = 560, H = 300, M = { t: 16, r: 18, b: 46, l: 80 };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function niceCeil(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
}
function scaleY(max) {
  const top = niceCeil(max * 1.05);
  const ticks = Array.from({ length: 6 }, (_, i) => (top / 5) * i);
  return { top, ticks };
}
const legend = series => `<div class="legend">${series.map(s =>
  `<span><i style="background:${s.color}${s.dash ? ';opacity:.55' : ''}"></i>${esc(s.name)}</span>`).join('')}</div>`;

function frame(sc, fmt, yTitle, xTitle) {
  const ih = H - M.t - M.b;
  const y = v => M.t + ih - (v / sc.top) * ih;
  const grid = sc.ticks.map(t => `<line x1="${M.l}" x2="${W - M.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/>
    <text x="${M.l - 8}" y="${y(t) + 4}" class="tick" text-anchor="end">${esc(fmt(t))}</text>`).join('');
  const yt = yTitle ? `<text transform="translate(13 ${M.t + ih / 2}) rotate(-90)" class="axt" text-anchor="middle">${esc(yTitle)}</text>` : '';
  const xt = xTitle ? `<text x="${M.l + (W - M.l - M.r) / 2}" y="${H - 6}" class="axt" text-anchor="middle">${esc(xTitle)}</text>` : '';
  return { y, ih, html: grid + yt + xt };
}

export function barChart({ labels, series, fmt = String, yTitle = '', xTitle = '', legendItems = null }) {
  const vals = series.flatMap(s => s.values).filter(v => v != null);
  if (!vals.length) return '';
  const sc = scaleY(Math.max(...vals));
  const f = frame(sc, fmt, yTitle, xTitle);
  const pw = W - M.l - M.r, gw = pw / labels.length, bw = Math.min(46, (gw * 0.7) / series.length);
  let bars = '';
  labels.forEach((lab, i) => {
    const gx = M.l + gw * i + gw / 2 - (bw * series.length) / 2;
    series.forEach((s, j) => {
      const v = s.values[i]; if (v == null) return;
      const x = gx + j * bw, y = f.y(v);
      bars += `<rect x="${x}" y="${y}" width="${bw - 3}" height="${Math.max(1, M.t + f.ih - y)}" rx="4" fill="${s.colors?.[i] ?? s.color}"><title>${esc(s.name)} — ${esc(lab)}: ${esc(fmt(v))}</title></rect>
        <text x="${x + (bw - 3) / 2}" y="${y - 5}" class="val" text-anchor="middle">${esc(fmt(v))}</text>`;
    });
    bars += `<text x="${M.l + gw * i + gw / 2}" y="${H - M.b + 18}" class="tick" text-anchor="middle">${esc(lab)}</text>`;
  });
  return `<div class="chart">${legendItems ? legend(legendItems) : series.length > 1 ? legend(series) : ''}<svg viewBox="0 0 ${W} ${H}" role="img">${f.html}${bars}</svg></div>`;
}

export function lineChart({ labels, series, fmt = String, yTitle = '', xTitle = '', minTop = 0 }) {
  const vals = series.flatMap(s => s.values).filter(v => v != null);
  if (!vals.length) return '';
  const sc = scaleY(Math.max(...vals, minTop));
  const f = frame(sc, fmt, yTitle, xTitle);
  const pw = W - M.l - M.r;
  const x = i => M.l + (labels.length === 1 ? pw / 2 : (pw * i) / (labels.length - 1));
  let body = labels.map((lab, i) => `<text x="${x(i)}" y="${H - M.b + 18}" class="tick" text-anchor="middle">${esc(lab)}</text>`).join('');
  series.forEach(s => {
    const pts = s.values.map((v, i) => (v == null ? null : [x(i), f.y(v), v, i])).filter(Boolean);
    if (pts.length > 1) body += `<polyline points="${pts.map(p => p[0] + ',' + p[1]).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.5" ${s.dash ? 'stroke-dasharray="6 5" opacity=".55"' : ''} stroke-linejoin="round"/>`;
    if (!s.dash) pts.forEach(p => { body += `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="#fff" stroke="${s.color}" stroke-width="2.5"><title>${esc(s.name)} — ${esc(labels[p[3]])}: ${esc(fmt(p[2]))}</title></circle>`; });
  });
  return `<div class="chart">${legend(series)}<svg viewBox="0 0 ${W} ${H}" role="img">${f.html}${body}</svg></div>`;
}
