// Command-line benchmark: same code path as the "Run benchmark" button in the GUI.
// Usage:  node scripts/benchmark.js [--reps 5] [--datasets 1000000,2000000]
// Writes benchmark/results/benchmark.json
import { startBenchmark, job, supportedThreads, RESULT_FILE } from '../backend/runner.js';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; };
const reps = Number(arg('reps', 5));
const datasets = arg('datasets', '') ? arg('datasets').split(',') : undefined;

console.log(`Benchmark: threads ${supportedThreads().join(', ')} · ${reps} repetition(s) per configuration`);
try { await startBenchmark({ datasets, reps }); } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
let last = '';
while (job.state === 'running') {
  const line = `[${job.done}/${job.total}] ${job.current}`;
  if (line !== last) { console.log(line); last = line; }
  await new Promise(r => setTimeout(r, 500));
}
if (job.state === 'error') { console.error('ERROR:', job.error); process.exit(1); }
console.log(`Done. Results saved to ${RESULT_FILE}`);
