import { compareResults, speedup, efficiency, FIELDS, REL_TOL } from './metrics.js';
import { barChart, lineChart } from './charts.js';

/* ======================================================================
   Static knowledge about the EXISTING algorithms (taken from the C++ source)
   ====================================================================== */
const ALGOS = [
  { id: 'sumavg', name: 'Sum & Average', purpose: 'Total and mean of Open price, Close price and Trading volume.',
    idea: 'Walk through the array once, keep running totals; mean = total ÷ n.',
    time: 'O(n)', space: 'O(1) extra', par: 'reduction(+: totalOpen, totalClose, totalVolume)', parTime: 'O(n/p + p)',
    keys: ['averageOpen', 'averageClose', 'totalVolume', 'averageVolume'] },
  { id: 'minmax', name: 'Minimum / Maximum', purpose: 'Highest "High" price and lowest "Low" price in the data set.',
    idea: 'Keep the best value seen so far; replace it when a better one is found.',
    time: 'O(n)', space: 'O(1) extra', par: 'reduction(max: highestPrice)  reduction(min: lowestPrice)', parTime: 'O(n/p + p)',
    keys: ['highestPrice', 'lowestPrice'] },
  { id: 'count', name: 'Counting', purpose: 'Number of EQ records, and how many have a positive / negative daily return.',
    idea: 'Increment a counter whenever a condition is true.',
    time: 'O(n)', space: 'O(1) extra', par: 'reduction(+: returnCount, positiveRecords, negativeRecords)', parTime: 'O(n/p + p)',
    keys: ['records', 'returnCount', 'positiveRecords', 'negativeRecords'] },
  { id: 'return', name: 'Daily Return (average)', purpose: 'Average percentage change of Close price relative to Previous Close.',
    idea: 'return = (close − prevClose) ÷ prevClose × 100 for each record with prevClose > 0; then average.',
    time: 'O(n)', space: 'O(1) extra', par: 'reduction(+: totalReturn)', parTime: 'O(n/p + p)',
    keys: ['averageReturn'] },
];
const LOADING = { name: 'CSV Data Loading (pre-processing)', purpose: 'Read the CSV, keep only rows with SctySrs = "EQ", convert 6 columns to numbers and store them in an array of records.',
  idea: 'Read line by line, split by commas, filter, push into a vector.', time: 'O(n · c)  (c = columns per row)', space: 'O(n)', par: 'Not parallelised — runs sequentially in BOTH programs' };
const OMP_VERSIONS = { 200805: '3.0', 201107: '3.1', 201307: '4.0', 201511: '4.5', 201811: '5.0', 202011: '5.1', 202111: '5.2' };

/* ======================================================================
   State
   ====================================================================== */
const S = {
  info: null, infoError: null, bench: null, job: null, runs: [],
  sel: { dataset: null, mode: 'sequential', threads: null, alg: 'all' },
  running: null, error: null,
  perf: { metric: 'computationTime', dataset: null, threads: null },
  benchSel: { datasets: null, reps: 3 },
};
let timer = null, poller = null, lastRoute = null;

/* ======================================================================
   Helpers
   ====================================================================== */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fInt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const fTime = s => (s == null ? '—' : s < 1 ? `${(s * 1000).toFixed(s * 1000 < 10 ? 2 : 1)} ms` : `${s.toFixed(3)} s`);
const fSp = v => (v == null ? '—' : `${v.toFixed(2)}×`);
const fEf = v => (v == null ? '—' : `${v.toFixed(1)}%`);
const fBytes = b => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1048576).toFixed(0)} MB`);
const fDS = n => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}K` : String(n));
const thr = t => `${t} thread${t > 1 ? 's' : ''}`;
function fVal(key, v) {
  if (v == null) return '—';
  if (['records', 'returnCount', 'positiveRecords', 'negativeRecords'].includes(key)) return fInt(v);
  if (key === 'averageReturn') return `${v.toFixed(6)} %`;
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 });
}
const fField = key => FIELDS.find(f => f.key === key);
const ompName = v => (v ? `OpenMP ${OMP_VERSIONS[v] ?? ''} (${v})` : null);

const latestRun = pred => [...S.runs].reverse().find(pred);
function runFor(mode) {
  const { dataset, threads } = S.sel;
  return latestRun(r => r.dataset === dataset && r.mode === mode && (mode === 'sequential' || r.requestedThreads === threads));
}
function pairNow() {
  const seq = runFor('sequential'), par = runFor('openmp');
  return seq && par ? { seq, par } : null;
}
function lastPair() {
  const par = latestRun(r => r.mode === 'openmp');
  const seq = par && latestRun(r => r.mode === 'sequential' && r.dataset === par.dataset);
  return par && seq ? { seq, par } : null;
}
function derive(p) {
  const t = p.par.threads;
  const spC = speedup(p.seq.computationTime, p.par.computationTime);
  const spT = speedup(p.seq.totalTime, p.par.totalTime);
  return { t, spC, spT, efC: efficiency(spC, t), efT: efficiency(spT, t), cmp: compareResults(p.seq, p.par) };
}
const dsInfo = id => S.info?.datasets.find(d => d.id === id);

/* ======================================================================
   API
   ====================================================================== */
async function api(path, body) {
  let res;
  try {
    res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Cannot reach the backend. Start it from the project folder with:  npm start');
  }
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new Error(data?.error || `Backend error (HTTP ${res.status}).`);
  return data;
}

async function loadInfo() {
  try {
    S.info = await api('/api/info');
    S.infoError = null;
    S.sel.dataset ??= S.info.datasets[0]?.id ?? null;
    S.sel.threads ??= S.info.threads.includes(4) ? 4 : S.info.threads.at(-1);
    S.perf.threads ??= S.sel.threads;
    S.benchSel.datasets ??= S.info.datasets.map(d => d.id);
    const b = await api('/api/benchmark'); S.bench = b.benchmark;
    S.perf.dataset ??= S.bench?.results[0]?.dataset ?? S.sel.dataset;
    S.job = await api('/api/benchmark/status');
    if (S.job.state === 'running') startPolling();
  } catch (e) { S.infoError = e.message; }
  render();
}

async function runProgram(mode) {
  const { dataset, threads } = S.sel;
  S.error = null;
  S.running = { mode, threads: mode === 'openmp' ? threads : 1, dataset, started: Date.now() };
  render();
  try {
    const r = await api('/api/run', { dataset, mode, threads: mode === 'openmp' ? threads : undefined });
    S.runs.push(r);
    return true;
  } catch (e) { S.error = e.message; return false; }
  finally { S.running = null; }
}
async function runSingle() { await runProgram(S.sel.mode); render(); }
async function runBoth() { if (await runProgram('sequential')) await runProgram('openmp'); S.sel.mode = 'openmp'; render(); }

function startPolling() {
  clearInterval(poller);
  poller = setInterval(async () => {
    try {
      S.job = await api('/api/benchmark/status');
      if (S.job.state !== 'running') {
        clearInterval(poller);
        const b = await api('/api/benchmark'); S.bench = b.benchmark;
        if (S.bench) S.perf.dataset = S.bench.results.some(r => r.dataset === S.perf.dataset) ? S.perf.dataset : S.bench.results[0].dataset;
      }
    } catch (e) { clearInterval(poller); S.job = { ...(S.job || {}), state: 'error', error: e.message }; }
    render();
  }, 1000);
}
async function startBenchmark() {
  S.error = null;
  try {
    await api('/api/benchmark/start', { datasets: S.benchSel.datasets, reps: S.benchSel.reps });
    S.job = await api('/api/benchmark/status'); startPolling();
  } catch (e) { S.error = e.message; }
  render();
}

/* ======================================================================
   Small UI pieces
   ====================================================================== */
const ICON = {
  dash: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z"/>',
  run: '<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z"/>',
  perf: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  book: '<path d="M4 4h10a4 4 0 014 4v12H8a4 4 0 01-4-4zM4 16a4 4 0 014-4h10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
};
const icon = n => `<svg viewBox="0 0 24 24">${ICON[n]}</svg>`;
const NAV = [['dashboard', 'Dashboard', 'dash'], ['analysis', 'Analysis', 'run'], ['performance', 'Performance', 'perf'], ['correctness', 'Correctness', 'check'], ['algorithms', 'Algorithms', 'book'], ['about', 'About Project', 'info']];

const pageHead = (t, s) => `<div class="page-head"><h1>${t}</h1><p>${s}</p></div>`;
const empty = (t, s) => `<div class="empty-state"><b>${t}</b>${s}</div>`;
const errBanner = () => (S.error ? `<div class="note err"><b>Something went wrong.</b> ${esc(S.error)}</div>` : '');

function loadingCard() {
  const r = S.running;
  const label = r.mode === 'sequential' ? 'Running Sequential Analysis…' : `Running OpenMP Parallel Analysis with ${thr(r.threads)}…`;
  return `<div class="card loading"><div class="spinner ${r.mode === 'openmp' ? 'par' : ''}"></div>
    <div><b style="font-size:16px">${label}</b><div class="muted small">Processing dataset (${fDS(Number(r.dataset))} records)… The real program is running — elapsed <b id="elapsed">0.0</b> s.<br>
    Most of the time is spent reading the CSV file; the parallel loop itself is much shorter.</div></div></div>`;
}

/* ======================================================================
   Pages
   ====================================================================== */
function pipeline() {
  const p = lastPair(); const d = p && derive(p);
  const anySeq = S.runs.some(r => r.mode === 'sequential'), anyPar = S.runs.some(r => r.mode === 'openmp');
  const steps = [
    ['1', 'Dataset', S.sel.dataset ? `${fDS(Number(S.sel.dataset))} selected` : 'none found', !!S.sel.dataset, '', '#/analysis'],
    ['2', 'Algorithm', 'Sum · Min/Max · Count · Return', true, '', '#/algorithms'],
    ['3', 'Sequential', anySeq ? 'completed' : 'not run yet', anySeq, 'seq', '#/analysis'],
    ['4', 'OpenMP', anyPar ? 'completed' : 'not run yet', anyPar, 'par', '#/analysis'],
    ['5', 'Correctness', d ? (d.cmp.match ? '✓ match' : '✗ mismatch') : 'pending', !!d, d && !d.cmp.match ? 'bad' : '', '#/correctness'],
    ['6', 'Exec. time', d ? `${fTime(p.seq.computationTime)} → ${fTime(p.par.computationTime)}` : 'pending', !!d, '', '#/analysis'],
    ['7', 'Speedup', d ? fSp(d.spC) : 'pending', !!d, '', '#/performance'],
    ['8', 'Efficiency', d ? fEf(d.efC) : 'pending', !!d, '', '#/performance'],
    ['9', 'Scalability', S.bench ? 'benchmark recorded' : 'run benchmark', !!S.bench, '', '#/performance'],
  ];
  return `<div class="flow">${steps.map(([n, t, s, done, cls, href]) =>
    `<a class="step ${done ? 'done' : ''} ${cls}" href="${href}"><div class="dot">${cls === 'bad' ? '✗' : done ? '✓' : n}</div><b>${t}</b><span>${esc(s)}</span></a>`).join('')}</div>`;
}

function kpiCards(p) {
  if (!p) return `<div class="card kpi empty" style="grid-column:1/-1">${empty('No live result yet', 'Go to <a href="#/analysis">Analysis</a> and press <b>Run Sequential → Parallel</b> to see execution time, speedup and efficiency here.')}</div>`;
  const d = derive(p);
  return `
  <div class="card kpi"><div class="lab">Execution time · computation</div><div class="big" style="font-size:21px"><span class="c-seq">${fTime(p.seq.computationTime)}</span> <span class="muted">→</span> <span class="c-par">${fTime(p.par.computationTime)}</span></div>
    <div class="row"><span>Total incl. loading</span><b>${fTime(p.seq.totalTime)} → ${fTime(p.par.totalTime)}</b></div></div>
  <div class="card kpi"><div class="lab">Speedup</div><div class="big">${fSp(d.spC)}</div>
    <div class="row"><span>Total incl. loading</span><b>${fSp(d.spT)}</b></div></div>
  <div class="card kpi"><div class="lab">Parallel efficiency</div><div class="big">${fEf(d.efC)}</div>
    <div class="row"><span>Total incl. loading</span><b>${fEf(d.efT)}</b></div></div>
  <div class="card kpi"><div class="lab">Threads · dataset</div><div class="big">${d.t} <span class="muted" style="font-size:16px">· ${fDS(p.par.records)}</span></div>
    <div class="row"><span>Correctness</span><b class="${d.cmp.match ? 'c-ok' : 'c-bad'}">${d.cmp.match ? '✓ MATCH' : '✗ MISMATCH'}</b></div></div>`;
}

function systemCard() {
  const i = S.info.system;
  const ompV = latestRun(r => r.mode === 'openmp')?.ompVersion ?? S.bench?.system?.ompVersion;
  return `<div class="card"><h2>System information</h2><p class="sub">Read from this machine and from the compiled programs.</p><dl class="kv">
    <dt>CPU</dt><dd>${esc(i.cpu)}</dd><dt>Logical cores</dt><dd>${i.logicalCores}</dd>
    <dt>Memory</dt><dd>${i.memoryGB} GB</dd><dt>Platform</dt><dd>${esc(i.platform)}</dd>
    <dt>OpenMP program</dt><dd>${i.openmpBuilt ? 'built ✓' : '<span class="c-bad">not built</span>'}</dd>
    <dt>Sequential program</dt><dd>${i.sequentialBuilt ? 'built ✓' : '<span class="c-bad">not built</span>'}</dd>
    <dt>OpenMP version</dt><dd>${ompV ? esc(ompName(ompV)) : 'shown after the first parallel run'}</dd>
    <dt>Selected threads</dt><dd>${S.sel.threads}</dd>
    <dt>Selected dataset</dt><dd>${S.sel.dataset ? fDS(Number(S.sel.dataset)) + ' records' : '—'}</dd></dl></div>`;
}

function datasetCards(clickable) {
  return S.info.datasets.map(d => `<button class="opt ${S.sel.dataset === d.id ? 'on' : ''}" ${clickable ? `data-action="dataset" data-v="${d.id}"` : 'disabled style="cursor:default"'}>
    <b>${fDS(d.nominalRecords)} records</b><small>${d.file} · ${fInt(d.rows)} rows · ${fBytes(d.sizeBytes)}</small></button>`).join('');
}

function whyOpenMP() {
  return `<div class="card"><h2>Why OpenMP?</h2><p class="sub">Short version for the viva</p>
    <p style="margin:0 0 8px">OpenMP lets us split the iterations of a <code class="i">for</code> loop across several CPU threads by adding one line (<code class="i">#pragma omp parallel for</code>).</p>
    <p style="margin:0">It fits this project because every stock record is processed <b>independently</b> — the only shared results (sums, counts, min, max) are combined safely using <code class="i">reduction</code> clauses.</p></div>`;
}

function pageDashboard() {
  return `
  <div class="card hero"><span class="badge">DAA + Parallel Programming</span><h1>Stock Market Data Analysis</h1><p>Sequential vs OpenMP Parallel Processing</p></div>
  <div class="card mt"><h2>Project flow</h2><p class="sub">Each box turns green when a real result exists for it.</p>${pipeline()}</div>
  <div class="grid g4 mt">${kpiCards(lastPair())}</div>
  <div class="grid g2 mt"><div class="card"><h2>Available datasets</h2><p class="sub">Found in the <code class="i">data/</code> folder.</p><div class="opts">${S.info.datasets.length ? datasetCards(false) : empty('No dataset found', 'Place nse_&lt;records&gt;.csv files in the data/ folder.')}</div></div>${systemCard()}</div>
  <div class="grid g2 mt">${whyOpenMP()}
    <div class="card"><h2>Start the demonstration</h2><p class="sub">Suggested order</p><ol style="margin:0;padding-left:20px;line-height:1.9"><li>Open <a href="#/analysis">Analysis</a>, choose a dataset</li><li>Run <b class="c-seq">Sequential</b>, then <b class="c-par">Parallel</b> with 4 threads</li><li>Check <a href="#/correctness">Correctness</a></li><li>Open <a href="#/performance">Performance</a> and run the benchmark</li></ol></div></div>`;
}

/* ---------- Analysis ---------- */
function resultGroups(run) {
  const show = a => S.sel.alg === 'all' || S.sel.alg === a.id;
  const groups = ALGOS.filter(show).map(a => `<div class="res-group"><h4>${a.name} <span class="pill muted">${a.time}</span></h4><dl class="kv">
    ${a.keys.map(k => `<dt>${fField(k).label}</dt><dd class="mono">${fVal(k, run[k])}</dd>`).join('')}</dl></div>`).join('');
  const timing = S.sel.alg === 'all' ? `<div class="res-group"><h4>Timing measured by the program</h4><dl class="kv">
    <dt>Data loading (sequential)</dt><dd class="mono">${fTime(run.loadingTime)}</dd>
    <dt>Computation (${run.mode === 'openmp' ? 'OpenMP loop' : 'sequential loop'})</dt><dd class="mono">${fTime(run.computationTime)}</dd>
    <dt>Total</dt><dd class="mono">${fTime(run.totalTime)}</dd><dt>Threads</dt><dd class="mono">${run.threads}</dd></dl></div>` : '';
  return groups + timing;
}

function comparisonTable(p, d) {
  const row = (m, a, b) => `<tr><td>${m}</td><td class="mono">${a}</td><td class="mono">${b}</td></tr>`;
  return `<div class="scroll"><table><thead><tr><th>Metric</th><th class="s">Sequential</th><th class="p">OpenMP Parallel</th></tr></thead><tbody>
    ${row('Threads', 1, p.par.threads)}
    ${row('Records processed', fInt(p.seq.records), fInt(p.par.records))}
    ${row('Data loading time', fTime(p.seq.loadingTime), fTime(p.par.loadingTime))}
    ${row('<b>Computation time</b>', `<b>${fTime(p.seq.computationTime)}</b>`, `<b>${fTime(p.par.computationTime)}</b>`)}
    ${row('Total execution time', fTime(p.seq.totalTime), fTime(p.par.totalTime))}
    ${row('Total trading volume', fVal('totalVolume', p.seq.totalVolume), fVal('totalVolume', p.par.totalVolume))}
    ${row('Average daily return', fVal('averageReturn', p.seq.averageReturn), fVal('averageReturn', p.par.averageReturn))}
    ${row('Highest / Lowest price', `${fVal('highestPrice', p.seq.highestPrice)} / ${fVal('lowestPrice', p.seq.lowestPrice)}`, `${fVal('highestPrice', p.par.highestPrice)} / ${fVal('lowestPrice', p.par.lowestPrice)}`)}
    ${row('Status', '<span class="pill ok">Completed</span>', '<span class="pill ok">Completed</span>')}
    ${row('Results agree?', '', d.cmp.match ? '<span class="pill ok">✓ MATCH</span>' : '<span class="pill bad">✗ MISMATCH</span>')}
  </tbody></table></div>`;
}

function perfCards(p, d) {
  return `<div class="grid auto">
    <div class="card kpi"><div class="lab">Execution time</div><div class="row"><span class="c-seq">Sequential</span><b>${fTime(p.seq.computationTime)}</b></div><div class="row"><span class="c-par">Parallel</span><b>${fTime(p.par.computationTime)}</b></div><div class="row"><span>Total (with loading)</span><b>${fTime(p.seq.totalTime)} / ${fTime(p.par.totalTime)}</b></div></div>
    <div class="card kpi"><div class="lab">Speedup</div><div class="big">${fSp(d.spC)}</div><div class="row"><span>= T<sub>seq</sub> ÷ T<sub>par</sub></span><b>total: ${fSp(d.spT)}</b></div></div>
    <div class="card kpi"><div class="lab">Parallel efficiency</div><div class="big">${fEf(d.efC)}</div><div class="row"><span>= speedup ÷ ${d.t} × 100</span><b>total: ${fEf(d.efT)}</b></div></div>
    <div class="card kpi"><div class="lab">Threads · dataset</div><div class="big">${d.t}</div><div class="row"><span>Dataset size</span><b>${fInt(p.par.records)} records</b></div></div></div>`;
}

function amdahlNote(seq) {
  const f = seq.loadingTime / seq.totalTime;
  const maxSp = 1 / f;
  return `<div class="note info"><b>Why is the total-time speedup so small?</b> Reading the CSV is sequential in both programs and takes
    <b>${(f * 100).toFixed(1)}%</b> of the sequential run. By Amdahl's law, parallelising only the remaining ${((1 - f) * 100).toFixed(1)}% can never give more than about <b>${maxSp.toFixed(2)}×</b> end-to-end.
    The OpenMP loop itself is measured as <i>computation time</i>.
    <div class="amdahl"><div style="flex:${f};background:#64748b">loading ${(f * 100).toFixed(1)}%</div><div style="flex:${Math.max(1 - f, 0.001)};background:var(--par)"></div></div></div>`;
}

function pageAnalysis() {
  if (!S.info.datasets.length) return pageHead('Analysis', 'Run the real programs on a real dataset.') + `<div class="card">${empty('No dataset found', 'Put nse_&lt;records&gt;.csv files into the <code class="i">data/</code> folder and reload.')}</div>`;
  const s = S.sel, busy = !!S.running, built = S.info.system;
  const mode = s.mode;
  const cur = runFor(mode);
  const p = pairNow(), d = p && derive(p);
  const controls = `<div class="card"><label class="f">1 · Dataset</label><div class="opts">${datasetCards(true)}</div>
    <label class="f">2 · Algorithm view</label><div class="chips"><button class="chip small alg ${s.alg === 'all' ? 'on' : ''}" data-action="alg" data-v="all">All</button>
      ${ALGOS.map(a => `<button class="chip small alg ${s.alg === a.id ? 'on' : ''}" data-action="alg" data-v="${a.id}">${a.name}</button>`).join('')}</div>
    <p class="muted small" style="margin:8px 0 0">The program computes all of these in one pass; this only filters what is displayed.</p>
    <label class="f">3 · Processing mode</label><div class="seg"><button class="${mode === 'sequential' ? 'on' : ''}" data-action="mode" data-v="sequential">Sequential</button><button class="par ${mode === 'openmp' ? 'on par' : ''}" data-action="mode" data-v="openmp">OpenMP Parallel</button></div>
    ${mode === 'openmp' ? `<label class="f">4 · Threads</label><div class="chips">${S.info.threads.map(t => `<button class="chip ${s.threads === t ? 'on' : ''}" data-action="threads" data-v="${t}">${t}</button>`).join('')}</div>
      <p class="muted small" style="margin:8px 0 0">Offered: up to the ${built.logicalCores} logical core${built.logicalCores > 1 ? 's' : ''} of this machine.</p>` : ''}
    <div class="btns"><button class="btn ${mode === 'openmp' ? 'par' : ''}" data-action="run" ${busy || !(mode === 'openmp' ? built.openmpBuilt : built.sequentialBuilt) ? 'disabled' : ''}>▶ Run ${mode === 'openmp' ? `OpenMP (${thr(s.threads)})` : 'Sequential'}</button>
      <button class="btn ghost" data-action="run-both" ${busy || !built.openmpBuilt || !built.sequentialBuilt ? 'disabled' : ''}>⇄ Run Sequential → Parallel &amp; compare</button></div>
    ${!built.sequentialBuilt || !built.openmpBuilt ? '<div class="note warn">A program is not compiled yet. Run <code class="i">./scripts/build.sh</code> in the project folder.</div>' : ''}</div>`;

  let right = errBanner();
  if (busy) right += loadingCard();
  else if (cur) right += `<div class="card"><h2>Result · <span class="${cur.mode === 'openmp' ? 'c-par' : 'c-seq'}">${cur.mode === 'openmp' ? `OpenMP, ${thr(cur.threads)}` : 'Sequential'}</span> · ${fDS(cur.records)} records</h2>
      <p class="sub">Real output of <code class="i">build/${cur.mode}</code>, finished ${new Date(cur.ranAt).toLocaleTimeString()}.</p>${resultGroups(cur)}</div>`;
  else right += `<div class="card">${empty('No result yet for this selection', 'Press <b>Run</b> to execute the real program.')}</div>`;

  if (!busy && p) right += `<div class="card mt"><h2>Sequential vs Parallel comparison</h2><p class="sub">Dataset ${fDS(p.par.records)}, ${thr(p.par.threads)}. Latest run of each.</p>${comparisonTable(p, d)}</div>
    <div class="mt">${perfCards(p, d)}</div>
    <div class="grid g2 mt"><div class="card"><h2>Computation time</h2><p class="sub">The loop that OpenMP parallelises</p>${timeBars(p, 'computationTime')}</div>
      <div class="card"><h2>Total time</h2><p class="sub">Loading + computation</p>${timeBars(p, 'totalTime')}</div></div>
    <div class="mt">${amdahlNote(p.seq)}</div>`;
  else if (!busy && cur) right += `<div class="note info mt">Run both modes (same dataset${mode === 'openmp' ? ' and thread count' : ''}) to unlock the comparison, speedup, efficiency and correctness check.</div>`;

  return pageHead('Analysis', 'Select dataset → algorithm → mode, then run the real C++ programs.') + `<div class="grid g-side">${controls}<div>${right}</div></div>`;
}
function timeBars(p, key) {
  return barChart({ labels: ['Sequential', `OpenMP · ${thr(p.par.threads)}`], series: [{ name: 'Time', color: '#2563eb', colors: ['#2563eb', '#ea580c'], values: [p.seq[key], p.par[key]] }], fmt: fTime, yTitle: 'Time', legendItems: [{ name: 'Sequential', color: '#2563eb' }, { name: 'OpenMP Parallel', color: '#ea580c' }] });
}

/* ---------- Performance ---------- */
function pagePerformance() {
  const b = S.bench, j = S.job || { state: 'idle' }, running = j.state === 'running';
  const all = S.info.datasets;
  const nRuns = (S.benchSel.datasets?.length || 0) * (1 + S.info.threads.length) * S.benchSel.reps;
  const control = `<div class="card"><h2>Benchmark experiments</h2><p class="sub">Runs the real programs: 1 sequential + OpenMP at every supported thread count, repeated; the <b>median</b> is stored in <code class="i">benchmark/results/benchmark.json</code>.</p>
    <div class="grid g3" style="align-items:end"><div><label class="f">Datasets</label><div class="chips">${all.map(d => `<button class="chip small ${S.benchSel.datasets?.includes(d.id) ? 'on' : ''}" data-action="bench-ds" data-v="${d.id}" ${running ? 'disabled' : ''}>${fDS(d.nominalRecords)}</button>`).join('')}</div></div>
      <div><label class="f">Repetitions per configuration</label><input type="number" min="1" max="10" value="${S.benchSel.reps}" data-action="reps" ${running ? 'disabled' : ''} style="padding:8px 10px;border:1.5px solid var(--line);border-radius:10px;font:inherit;width:90px"></div>
      <div>${running ? '<button class="btn ghost sm" data-action="bench-cancel">Cancel</button>' : `<button class="btn par sm" data-action="bench-start" ${!nRuns || !S.info.system.openmpBuilt || !S.info.system.sequentialBuilt ? 'disabled' : ''}>▶ Run benchmark (${nRuns} runs)</button>`}</div></div>
    <p class="muted small" style="margin:10px 0 0">Thread counts used: ${S.info.threads.join(', ')}. Each run re-reads the CSV, so large datasets take a while.</p>
    ${running ? `<div class="bar"><i style="width:${(j.done / j.total) * 100}%"></i></div><div class="small"><b>${j.done} / ${j.total}</b> runs finished · now: ${esc(j.current)}</div>` : ''}
    ${j.state === 'error' ? `<div class="note err">${esc(j.error)}</div>` : ''}${errBanner()}</div>`;

  if (!b) return pageHead('Performance', 'Execution time, speedup, efficiency and scalability from recorded benchmark runs.') + control +
    `<div class="card mt">${empty('No benchmark results yet', 'Run benchmark experiments to generate performance data.')}</div>`;

  const P = S.perf;
  const dsList = [...new Set(b.results.map(r => r.dataset))];
  if (!dsList.includes(P.dataset)) P.dataset = dsList[0];
  const rows = b.results.filter(r => r.dataset === P.dataset);
  const seq = rows.find(r => r.mode === 'sequential');
  const pars = rows.filter(r => r.mode === 'openmp').sort((x, y) => x.threads - y.threads);
  const M = P.metric, spKey = M === 'computationTime' ? 'speedupCompute' : 'speedupTotal', efKey = M === 'computationTime' ? 'efficiencyCompute' : 'efficiencyTotal';
  const tl = pars.map(r => r.threads);
  const cores = S.info.system.logicalCores, recCores = b.system?.logicalCores;
  const sameMachine = recCores === cores;

  const picker = `<div class="card mt" style="padding:14px 20px"><div style="display:flex;gap:26px;flex-wrap:wrap;align-items:center">
    <div><span class="muted small">Dataset&nbsp;</span>${dsList.map(d => `<button class="chip small ${P.dataset === d ? 'on' : ''}" data-action="perf-ds" data-v="${d}">${fDS(Number(d))}</button>`).join(' ')}</div>
    <div><span class="muted small">Metric&nbsp;</span><button class="chip small ${M === 'computationTime' ? 'on' : ''}" data-action="metric" data-v="computationTime">Computation (parallel loop)</button> <button class="chip small ${M === 'totalTime' ? 'on' : ''}" data-action="metric" data-v="totalTime">Total (loading + computation)</button></div></div></div>`;

  const c1 = barChart({ labels: ['Sequential', ...tl.map(t => `OpenMP ${t}T`)], series: [{ name: 'Time', color: '#2563eb', colors: ['#2563eb', ...tl.map(() => '#ea580c')], values: [seq?.median[M] ?? null, ...pars.map(r => r.median[M])] }], fmt: fTime, yTitle: 'Median time', legendItems: [{ name: 'Sequential', color: '#2563eb' }, { name: 'OpenMP', color: '#ea580c' }] });
  const c2 = lineChart({ labels: tl.map(String), xTitle: 'Threads', yTitle: 'Speedup (×)', fmt: v => v.toFixed(2), minTop: Math.max(...tl, 1),
    series: [{ name: 'Measured speedup', color: '#ea580c', values: pars.map(r => r[spKey]) }, { name: 'Ideal (linear)', color: '#64748b', dash: true, values: tl }] });
  const c4 = lineChart({ labels: tl.map(String), xTitle: 'Threads', yTitle: 'Efficiency (%)', fmt: v => v.toFixed(0), minTop: 100,
    series: [{ name: 'Measured efficiency', color: '#7c3aed', values: pars.map(r => r[efKey]) }, { name: 'Ideal (100%)', color: '#64748b', dash: true, values: tl.map(() => 100) }] });
  const sizes = dsList.map(Number).sort((a, c) => a - c);
  const get = (ds, mode, t) => b.results.find(r => r.dataset === String(ds) && r.mode === mode && r.threads === t)?.median[M] ?? null;
  const palette = ['#ea580c', '#f59e0b', '#7c3aed', '#059669', '#0891b2'];
  const c3 = lineChart({ labels: sizes.map(fDS), xTitle: 'Dataset size (records)', yTitle: 'Median time', fmt: fTime,
    series: [{ name: 'Sequential', color: '#2563eb', values: sizes.map(s => get(s, 'sequential', 1)) }, ...[...new Set(b.results.filter(r => r.mode === 'openmp').map(r => r.threads))].sort((x, y) => x - y).map((t, i) => ({ name: `OpenMP ${t}T`, color: palette[i % palette.length], values: sizes.map(s => get(s, 'openmp', t)) }))] });

  const meta = `<div class="note ${sameMachine ? 'info' : 'warn'} mt">Recorded benchmark: <b>${new Date(b.generatedAt).toLocaleString()}</b> · ${b.repetitions} repetitions, statistic = ${b.statistic} · machine: ${esc(b.system?.cpu)} (${recCores} logical cores).
    ${sameMachine ? '' : `<br><b>Note:</b> this machine now reports ${cores} logical cores — the recorded results came from a different configuration. Re-run the benchmark here for matching numbers.`}
    ${recCores && Math.max(...tl) > recCores ? `<br><b>Note:</b> thread counts above the core count are over-subscribed, so no real speedup is expected.` : ''}
    ${seq && seq.median.computationTime < 0.05 ? `<br><b>Note:</b> the computation phase is only ${fTime(seq.median.computationTime)}, so run-to-run timing noise is large. Use more repetitions (e.g. 5–10) for stable speedup numbers.` : ''}</div>`;

  const table = `<div class="card mt"><h2>All recorded measurements</h2><p class="sub">Median of ${b.repetitions} runs. Speedup uses the sequential median of the same dataset.</p><div class="scroll"><table><thead><tr><th>Dataset</th><th>Mode</th><th>Threads</th><th>Loading</th><th>Computation</th><th>Total</th><th>Speedup (comp.)</th><th>Efficiency (comp.)</th><th>Speedup (total)</th><th>Efficiency (total)</th><th>Correct</th></tr></thead><tbody>
    ${[...b.results].sort((x, y) => x.records - y.records || (x.mode === 'sequential' ? -1 : 1) - (y.mode === 'sequential' ? -1 : 1) || x.threads - y.threads).map(r => `<tr><td>${fDS(r.records)}</td><td><span class="pill ${r.mode === 'openmp' ? 'p' : 's'}">${r.mode === 'openmp' ? 'OpenMP' : 'Sequential'}</span></td><td>${r.threads}</td>
      <td class="mono">${fTime(r.median.loadingTime)}</td><td class="mono">${fTime(r.median.computationTime)}</td><td class="mono">${fTime(r.median.totalTime)}</td>
      <td class="mono">${r.mode === 'openmp' ? fSp(r.speedupCompute) : '—'}</td><td class="mono">${r.mode === 'openmp' ? fEf(r.efficiencyCompute) : '—'}</td><td class="mono">${r.mode === 'openmp' ? fSp(r.speedupTotal) : '—'}</td><td class="mono">${r.mode === 'openmp' ? fEf(r.efficiencyTotal) : '—'}</td>
      <td>${r.correctness ? (r.correctness.match ? '<span class="pill ok">✓</span>' : '<span class="pill bad">✗</span>') : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;

  const scal = sizes.length > 1 ? `<div class="card mt"><h2>Scalability: larger dataset → more work</h2><p class="sub">${sizes.map(fDS).join(' → ')} records. Compare how time grows for sequential and for each OpenMP thread count.</p>${c3}</div>`
    : `<div class="card mt"><h2>Scalability</h2>${empty('Only one dataset in the recorded benchmark', 'Select two or more datasets and re-run the benchmark to see how time grows with input size.')}</div>`;

  return pageHead('Performance', 'Recorded benchmark results (real measurements of the compiled programs).') + control + meta + picker +
    `<div class="grid g2 mt"><div class="card"><h2>Execution time: Sequential vs OpenMP</h2><p class="sub">${fDS(Number(P.dataset))} records</p>${c1}</div>
     <div class="card"><h2>Speedup vs number of threads</h2><p class="sub">Speedup = T<sub>seq</sub> ÷ T<sub>par</sub></p>${c2}</div>
     <div class="card"><h2>Parallel efficiency vs threads</h2><p class="sub">Efficiency = speedup ÷ threads × 100</p>${c4}</div>
     <div class="card"><h2>Reading the numbers</h2><p class="sub">What an evaluator may ask</p><ul style="margin:0;padding-left:18px;line-height:1.8"><li><b>Computation</b> = the OpenMP loop only.</li><li><b>Total</b> includes sequential CSV loading, so Amdahl's law caps it.</li><li>Speedup is normally below the ideal line because of thread start-up, memory bandwidth and the reduction step.</li>${seq ? `<li>Sequential loading share for this dataset: <b>${((seq.median.loadingTime / seq.median.totalTime) * 100).toFixed(1)}%</b> of total time.</li>` : ''}</ul></div></div>` + scal + table;
}

/* ---------- Correctness ---------- */
function cmpTable(cmp, tPar) {
  return `<div class="scroll"><table><thead><tr><th>Field</th><th>Rule</th><th class="s">Sequential</th><th class="p">Parallel (${tPar}T)</th><th>Abs. diff</th><th>Rel. diff</th><th>Status</th></tr></thead><tbody>
    ${cmp.rows.map(r => `<tr><td>${r.label}</td><td><span class="pill muted">${r.rule === 'exact' ? 'exact' : `≤ ${REL_TOL.toExponential(0)}`}</span></td><td class="mono">${fVal(r.key, r.seq)}</td><td class="mono">${fVal(r.key, r.par)}</td>
      <td class="mono">${r.absDiff === 0 ? '0' : r.absDiff.toPrecision(3)}</td><td class="mono">${r.relDiff === 0 ? '0' : r.relDiff.toExponential(2)}</td><td>${r.ok ? '<span class="pill ok">✓ MATCH</span>' : '<span class="pill bad">✗ MISMATCH</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}
function pageCorrectness() {
  const p = lastPair(); const d = p && derive(p);
  let live;
  if (!p) live = `<div class="card">${empty('Nothing to compare yet', 'Run Sequential and OpenMP on the same dataset in <a href="#/analysis">Analysis</a> (or use “Run Sequential → Parallel”).')}</div>`;
  else live = `<div class="card"><div class="verdict ${d.cmp.match ? 'ok' : 'bad'}"><span style="font-size:30px">${d.cmp.match ? '✓' : '✗'}</span><div>Status: ${d.cmp.match ? 'MATCH' : 'MISMATCH'}<small>Sequential vs OpenMP (${thr(p.par.threads)}) on ${fDS(p.par.records)} records — every field compared programmatically.</small></div></div>
    <div class="mt">${cmpTable(d.cmp, p.par.threads)}</div>
    ${d.cmp.match && !d.cmp.allBitIdentical ? `<div class="note info"><b>Why are some floating-point values not bit-identical?</b> Adding millions of decimals in a different order (each thread sums its own chunk, then the partial sums are combined) changes the last few binary digits. The differences above are ~10<sup>-13</sup> relative, so the results are equivalent. Counts, minimum and maximum must be — and are — exactly equal.</div>` : ''}</div>`;
  let rec = '';
  if (S.bench) rec = `<div class="card mt"><h2>Recorded benchmark: correctness of every configuration</h2><p class="sub">Each OpenMP configuration was compared field by field with the sequential result of the same dataset.</p><div class="scroll"><table><thead><tr><th>Dataset</th><th>Threads</th><th>Status</th><th>Bit-identical?</th></tr></thead><tbody>
    ${S.bench.results.filter(r => r.mode === 'openmp').sort((a, b) => a.records - b.records || a.threads - b.threads).map(r => `<tr><td>${fDS(r.records)}</td><td>${r.threads}</td><td>${r.correctness.match ? '<span class="pill ok">✓ MATCH</span>' : '<span class="pill bad">✗ MISMATCH</span>'}</td><td>${r.correctness.allBitIdentical ? 'yes' : 'no (float rounding)'}</td></tr>`).join('')}</tbody></table></div></div>`;
  return pageHead('Correctness Verification', 'Do the sequential and parallel programs produce the same result?') + live + rec;
}

/* ---------- Algorithms ---------- */
function pageAlgorithms() {
  const card = (a, par) => `<div class="card alg-card"><h2>${a.name}</h2><p style="margin:0 0 6px">${a.purpose}</p><p class="muted small" style="margin:0"><b>Basic idea:</b> ${a.idea}</p>
    <div class="tags"><span class="pill s">Sequential time ${a.time}</span><span class="pill p">Parallel ${a.parTime ? a.parTime : 'n/a'}</span><span class="pill muted">Space ${a.space}</span></div>
    <p class="small" style="margin:0"><b>Status:</b> ${par ? `✅ Sequential &nbsp; ✅ OpenMP` : '✅ Sequential &nbsp; ⛔ not parallelised'}</p>${par ? `<pre>// part of the single parallel loop:\n#pragma omp parallel for  ${esc(a.par)}</pre>` : `<p class="muted small" style="margin:6px 0 0">${a.par ?? ''}</p>`}</div>`;
  return pageHead('Algorithms Used', 'Everything the existing C++ programs actually compute. Complexities use n = number of records, p = threads.') +
    `<div class="note info">All four analyses below are computed together in <b>one loop</b> over the records (<code class="i">for (i = 0; i &lt; totalRecords; i++)</code>), so the whole loop is O(n) time sequentially and O(n/p + p) with OpenMP reductions.</div>
    <div class="grid g2">${ALGOS.map(a => card(a, true)).join('')}${card({ ...LOADING, parTime: null }, false)}</div>
    <div class="grid g2 mt">${whyOpenMP()}<div class="card"><h2>Speedup &amp; efficiency</h2><p class="sub">Formulas used by this dashboard</p>
      <pre>Speedup    = T_sequential ÷ T_parallel
Efficiency = Speedup ÷ Threads × 100</pre>
      <p class="muted small" style="margin:0">Both are computed from the times printed by the programs, for the computation phase and for the total (loading + computation).</p></div></div>`;
}

/* ---------- About ---------- */
function pageAbout() {
  return pageHead('About Project', 'Stock Market Data Analysis — DAA + Parallel Programming (OpenMP)') +
    `<div class="grid g2"><div class="card"><h2>What this project does</h2><p>Reads NSE equity (EQ series) records from a CSV file and computes simple statistics — sums, averages, minimum, maximum, counts and the average daily return — first with a <b>sequential</b> C++ program and then with an <b>OpenMP</b> parallel C++ program. The goal is to compare correctness, execution time, speedup, efficiency and scalability.</p>
      <p class="muted small">This dashboard only runs and visualises the existing programs. It does not contain any machine learning.</p></div>
    <div class="card"><h2>Project files</h2><dl class="kv"><dt>src/sequential.cpp</dt><dd>sequential version</dd><dt>src/openmp.cpp</dt><dd>OpenMP version</dd><dt>data/nse_*.csv</dt><dd>datasets</dd><dt>generate_datasets.py</dt><dd>builds the 2M file</dd><dt>scripts/build.sh</dt><dd>compiles both programs</dd><dt>backend/</dt><dd>local Node.js server</dd><dt>frontend/</dt><dd>this dashboard</dd><dt>benchmark/results/</dt><dd>recorded benchmark JSON</dd></dl></div></div>
    <div class="card mt"><h2>Honest notes for the evaluator</h2><ul style="margin:0;padding-left:18px;line-height:1.8">
      <li>CSV loading is sequential in both programs, so end-to-end speedup is limited (Amdahl's law). The parallel part is the computation loop.</li>
      <li>The 2M dataset is created by repeating the 1M EQ records (see <code class="i">generate_datasets.py</code>), so it has the same distribution as the 1M file.</li>
      <li>Floating-point sums can differ in the last digits between sequential and parallel runs because the addition order differs; counts, min and max are exactly equal.</li>
      <li>Timing noise is visible for very short computation times, so the benchmark stores the median of several runs.</li></ul></div>`;
}

/* ======================================================================
   Rendering / routing / events
   ====================================================================== */
const PAGES = { dashboard: pageDashboard, analysis: pageAnalysis, performance: pagePerformance, correctness: pageCorrectness, algorithms: pageAlgorithms, about: pageAbout };
const route = () => (location.hash.replace(/^#\//, '') || 'dashboard');

function render() {
  const r = PAGES[route()] ? route() : 'dashboard';
  const nav = NAV.map(([id, label, ic]) => `<a href="#/${id}" class="${r === id ? 'active' : ''}">${icon(ic)}${label}</a>`).join('');
  let body;
  if (S.infoError) body = `<div class="card"><div class="note err"><b>Cannot load project information.</b><br>${esc(S.infoError)}</div><button class="btn sm" data-action="reload">Try again</button></div>`;
  else if (!S.info) body = `<div class="card loading"><div class="spinner"></div><b>Loading project information…</b></div>`;
  else body = PAGES[r]();
  const y = window.scrollY;
  document.getElementById('app').innerHTML = `<div class="shell"><aside><div class="brand"><div class="logo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-6 4 3 8-9"/><path d="M15 5h5v5"/></svg></div><div>Stock Market<br>Data Analysis<small>DAA + Parallel Programming</small></div></div>${nav}<div class="side-foot">Sequential vs OpenMP<br>Live programs · real measurements</div></aside><main class="${r !== lastRoute ? 'animate' : ''}">${body}</main></div>`;
  lastRoute = r;
  window.scrollTo(0, y);
  clearInterval(timer);
  if (S.running) timer = setInterval(() => { const e = document.getElementById('elapsed'); if (e) e.textContent = ((Date.now() - S.running.started) / 1000).toFixed(1); }, 100);
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el || el.tagName === 'INPUT') return;
  const v = el.dataset.v;
  switch (el.dataset.action) {
    case 'dataset': S.sel.dataset = v; S.error = null; break;
    case 'alg': S.sel.alg = v; break;
    case 'mode': S.sel.mode = v; S.error = null; break;
    case 'threads': S.sel.threads = Number(v); break;
    case 'run': return runSingle();
    case 'run-both': return runBoth();
    case 'perf-ds': S.perf.dataset = v; break;
    case 'metric': S.perf.metric = v; break;
    case 'bench-ds': { const a = S.benchSel.datasets; S.benchSel.datasets = a.includes(v) ? a.filter(x => x !== v) : [...a, v]; break; }
    case 'bench-start': return startBenchmark();
    case 'bench-cancel': api('/api/benchmark/cancel', {}).catch(() => {}); return;
    case 'reload': return loadInfo();
  }
  render();
});
document.addEventListener('input', e => {
  if (e.target.dataset?.action === 'reps') {
    const n = Math.round(Number(e.target.value));
    if (n >= 1 && n <= 10) { S.benchSel.reps = n; const b = document.querySelector('[data-action="bench-start"]'); if (b) b.textContent = `▶ Run benchmark (${(S.benchSel.datasets?.length || 0) * (1 + S.info.threads.length) * n} runs)`; }
  }
});
window.addEventListener('hashchange', () => { S.error = null; render(); window.scrollTo(0, 0); });
render();
loadInfo();
