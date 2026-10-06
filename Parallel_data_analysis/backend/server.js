// Small local backend (no npm dependencies). Serves the dashboard and exposes
// only these controlled operations:
//   GET  /api/info              system, datasets, supported threads, build status
//   POST /api/run               run ONE program   {dataset, mode, threads}
//   GET  /api/benchmark         recorded benchmark results (benchmark/results/benchmark.json)
//   POST /api/benchmark/start   {datasets?, threads?, reps?}
//   GET  /api/benchmark/status  real progress of a running benchmark
//   POST /api/benchmark/cancel
// There is no endpoint that accepts a command or a file path.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, UserError, systemInfo, supportedThreads, listDatasets, runOnce,
  loadBenchmark, startBenchmark, cancelBenchmark, job,
} from './runner.js';

const PORT = Number(process.env.PORT) || 5050;
const HOST = '127.0.0.1'; // local only
const FRONTEND = path.join(ROOT, 'frontend');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 10_000) { reject(new UserError('Request too large.', 413)); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new UserError('Request body is not valid JSON.')); } });
  });
}

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  switch (route) {
    case 'GET /api/info':
      return send(res, 200, { system: systemInfo(), datasets: await listDatasets(), threads: supportedThreads() });
    case 'POST /api/run':
      return send(res, 200, await runOnce(await readBody(req)));
    case 'GET /api/benchmark':
      return send(res, 200, { benchmark: loadBenchmark() });
    case 'POST /api/benchmark/start':
      await startBenchmark(await readBody(req));
      return send(res, 202, { started: true });
    case 'GET /api/benchmark/status':
      return send(res, 200, job);
    case 'POST /api/benchmark/cancel':
      cancelBenchmark();
      return send(res, 200, { cancelled: true });
    default:
      return send(res, 404, { error: 'Unknown API endpoint.' });
  }
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(FRONTEND, rel));
  if (!file.startsWith(FRONTEND + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof UserError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Internal server error.' });
  }
}).listen(PORT, HOST, () => {
  console.log(`Stock Market Analysis dashboard:  http://localhost:${PORT}`);
  console.log(`Supported thread counts on this machine: ${supportedThreads().join(', ')}`);
});
