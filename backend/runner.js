// Controlled interface to the EXISTING C++ programs.
// Only two executables can ever be started (build/sequential, build/openmp),
// only with a dataset that exists in ./data, and only with a validated thread count.
// No shell is used (execFile with an argument array).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareResults, median, speedup, efficiency } from '../frontend/js/metrics.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const BUILD_DIR = path.join(ROOT, 'build');
export const RESULT_FILE = path.join(ROOT, 'benchmark', 'results', 'benchmark.json');

const BIN = {
  sequential: path.join(BUILD_DIR, 'sequential'),
  openmp: path.join(BUILD_DIR, 'openmp'),
};
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

export class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// ---------- system -------------------------------------------------------
export function systemInfo() {
  const cpus = os.cpus();
  const cores = cpus.length;
  return {
    cpu: cpus[0]?.model?.trim() || 'unknown',
    logicalCores: cores,
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    memoryGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
    node: process.version,
    sequentialBuilt: fs.existsSync(BIN.sequential),
    openmpBuilt: fs.existsSync(BIN.openmp),
  };
}

// Thread counts offered in the UI: 1,2,4,8,... up to the number of logical cores
// (plus the core count itself). Override with MAX_THREADS=<n> if you want to go higher.
export function supportedThreads() {
  const max = Math.max(1, parseInt(process.env.MAX_THREADS || '', 10) || os.cpus().length);
  const list = [];
  for (let t = 1; t <= max; t *= 2) list.push(t);
  if (!list.includes(max)) list.push(max);
  return list;
}

// ---------- datasets -----------------------------------------------------
const rowCache = new Map(); // file -> {mtimeMs, rows}

function countRows(file, mtimeMs) {
  const c = rowCache.get(file);
  if (c && c.mtimeMs === mtimeMs) return Promise.resolve(c.rows);
  return new Promise((resolve, reject) => {
    let nl = 0, last = 0;
    fs.createReadStream(file)
      .on('data', b => { for (let i = 0; i < b.length; i++) if (b[i] === 10) nl++; last = b[b.length - 1]; })
      .on('end', () => {
        const rows = Math.max(0, nl - 1 + (last === 10 ? 0 : 1)); // minus header line
        rowCache.set(file, { mtimeMs, rows });
        resolve(rows);
      })
      .on('error', reject);
  });
}

export async function listDatasets() {
  if (!fs.existsSync(DATA_DIR)) return [];
  const out = [];
  for (const name of fs.readdirSync(DATA_DIR)) {
    const m = /^nse_(\d+)\.csv$/.exec(name);
    if (!m) continue;
    const file = path.join(DATA_DIR, name);
    const st = fs.statSync(file);
    out.push({
      id: m[1], file: name, nominalRecords: Number(m[1]),
      rows: await countRows(file, st.mtimeMs), sizeBytes: st.size,
    });
  }
  return out.sort((a, b) => a.nominalRecords - b.nominalRecords);
}

// ---------- run one program ---------------------------------------------
let busy = false;
let cancelFlag = false;

function validate({ dataset, mode, threads }, datasets) {
  const ds = datasets.find(d => d.id === String(dataset));
  if (!ds) throw new UserError(`Unknown dataset "${dataset}". Available: ${datasets.map(d => d.id).join(', ') || 'none'}.`);
  if (mode !== 'sequential' && mode !== 'openmp') throw new UserError('Mode must be "sequential" or "openmp".');
  let t = 1;
  if (mode === 'openmp') {
    t = Number(threads);
    if (!Number.isInteger(t) || !supportedThreads().includes(t))
      throw new UserError(`Unsupported thread count "${threads}". Supported on this machine: ${supportedThreads().join(', ')}.`);
  }
  if (!fs.existsSync(BIN[mode]))
    throw new UserError(`The ${mode} program is not built yet. Run: ./scripts/build.sh`, 409);
  return { ds, t };
}

function exec(mode, ds, t) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    execFile(BIN[mode], [path.join(DATA_DIR, ds.file), '--json'], {
      cwd: ROOT, timeout: RUN_TIMEOUT_MS, maxBuffer: 1 << 20,
      env: { ...process.env, OMP_NUM_THREADS: String(t) },
    }, (err, stdout, stderr) => {
      const wallSeconds = Number(process.hrtime.bigint() - started) / 1e9;
      let parsed = null;
      try { parsed = JSON.parse(stdout.trim().split('\n').pop()); } catch { /* handled below */ }
      if (parsed?.error) return reject(new UserError(`Program reported: ${parsed.error}`, 500));
      if (err || !parsed) return reject(new UserError(
        `The ${mode} program failed${err?.killed ? ' (timed out)' : ''}: ${(stderr || err?.message || 'no output').toString().slice(0, 300)}`, 500));
      resolve({ ...parsed, dataset: ds.id, mode, requestedThreads: t, wallSeconds, ranAt: new Date().toISOString() });
    });
  });
}

export async function runOnce(params) {
  if (busy) throw new UserError('Another run is already in progress. Please wait for it to finish.', 409);
  const datasets = await listDatasets();
  const { ds, t } = validate(params, datasets);
  busy = true;
  try { return await exec(params.mode, ds, t); } finally { busy = false; }
}

// ---------- benchmark job ------------------------------------------------
export const job = { state: 'idle', done: 0, total: 0, current: '', error: null, startedAt: null, finishedAt: null };

export function loadBenchmark() {
  try { return JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8')); } catch { return null; }
}

export async function startBenchmark({ datasets: wanted, threads: wantedThreads, reps }) {
  if (busy || job.state === 'running') throw new UserError('Another run is already in progress.', 409);
  const all = await listDatasets();
  const chosen = (wanted?.length ? wanted : all.map(d => d.id)).map(id => {
    const d = all.find(x => x.id === String(id));
    if (!d) throw new UserError(`Unknown dataset "${id}".`);
    return d;
  });
  const tlist = (wantedThreads?.length ? wantedThreads : supportedThreads()).map(Number);
  for (const t of tlist) if (!supportedThreads().includes(t)) throw new UserError(`Unsupported thread count ${t}.`);
  const r = Number(reps ?? 3);
  if (!Number.isInteger(r) || r < 1 || r > 10) throw new UserError('Repetitions must be an integer from 1 to 10.');
  for (const m of ['sequential', 'openmp']) if (!fs.existsSync(BIN[m])) throw new UserError(`The ${m} program is not built. Run: ./scripts/build.sh`, 409);

  Object.assign(job, { state: 'running', done: 0, total: chosen.length * (1 + tlist.length) * r, current: '', error: null, startedAt: new Date().toISOString(), finishedAt: null });
  cancelFlag = false; busy = true;
  // run in background; the HTTP request returns immediately and the UI polls /api/benchmark/status
  (async () => {
    try {
      const results = [];
      for (const ds of chosen) {
        const configs = [{ mode: 'sequential', t: 1 }, ...tlist.map(t => ({ mode: 'openmp', t }))];
        for (const c of configs) {
          const runs = [];
          for (let i = 0; i < r; i++) {
            if (cancelFlag) throw new UserError('Benchmark cancelled.');
            job.current = `${ds.id} records · ${c.mode === 'sequential' ? 'Sequential' : `OpenMP ${c.t} thread${c.t > 1 ? 's' : ''}`} · repetition ${i + 1}/${r}`;
            runs.push(await exec(c.mode, ds, c.t));
            job.done++;
          }
          results.push({
            dataset: ds.id, records: runs[0].records, mode: c.mode, threads: c.t,
            runs: runs.map(x => ({ loadingTime: x.loadingTime, computationTime: x.computationTime, totalTime: x.totalTime })),
            median: {
              loadingTime: median(runs.map(x => x.loadingTime)),
              computationTime: median(runs.map(x => x.computationTime)),
              totalTime: median(runs.map(x => x.totalTime)),
            },
            result: runs[0],
          });
        }
      }
      // derived metrics + correctness (computed from the measurements above)
      for (const row of results) {
        const base = results.find(x => x.dataset === row.dataset && x.mode === 'sequential');
        if (row.mode === 'openmp') {
          row.speedupCompute = speedup(base.median.computationTime, row.median.computationTime);
          row.speedupTotal = speedup(base.median.totalTime, row.median.totalTime);
          row.efficiencyCompute = efficiency(row.speedupCompute, row.threads);
          row.efficiencyTotal = efficiency(row.speedupTotal, row.threads);
          const cmp = compareResults(base.result, row.result);
          row.correctness = { match: cmp.match, allBitIdentical: cmp.allBitIdentical };
        }
      }
      const file = { generatedAt: new Date().toISOString(), repetitions: r, statistic: 'median', system: { ...systemInfo(), ompVersion: results.find(x => x.mode === 'openmp')?.result.ompVersion ?? null }, results };
      fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
      fs.writeFileSync(RESULT_FILE, JSON.stringify(file, null, 2));
      job.state = 'done';
    } catch (e) {
      job.state = 'error'; job.error = e.message;
    } finally {
      job.finishedAt = new Date().toISOString(); job.current = ''; busy = false;
    }
  })();
}

export function cancelBenchmark() { cancelFlag = true; }
