/**
 * Optimizely Edge Delivery — Volume / Soak Test (Phase 2)
 * ════════════════════════════════════════════════════════
 * Fires a high volume of requests (default 10,000) across your URLs to:
 *   - Confirm consistent delivery under load
 *   - Detect any blank-page occurrences at scale
 *   - Measure response time distribution (p50 / p90 / p95 / p99)
 *   - Produce the evidence report for the customer
 *
 * USAGE:
 *   node soak-test.js https://customer-site.com/page1 https://customer-site.com/page2
 *
 * OPTIONS (environment variables):
 *   TOTAL=10000         Total requests to send               (default: 10000)
 *   CONCURRENCY=20      Parallel workers                     (default: 20)
 *   MIN_HTML_BYTES=5000 Min bytes to consider a full page    (default: 5000)
 *   HTML_MARKER=        HTML string that must appear         (default: none)
 *   OUTPUT_FILE=        Save JSON report here                (default: soak-report.json)
 *
 * REQUIREMENTS: Node.js 18+  (no npm install needed)
 */

'use strict';
const { writeFileSync } = require('fs');

(async () => {

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const URLS        = process.argv.slice(2).filter(function(a) { return a.startsWith('http'); });
const TOTAL       = Number(process.env.TOTAL          ?? 10000);
const CONCURRENCY = Number(process.env.CONCURRENCY    ?? 20);
const MIN_BYTES   = Number(process.env.MIN_HTML_BYTES ?? 5000);
const HTML_MARKER = process.env.HTML_MARKER           ?? '';
const MAX_RPS     = Number(process.env.MAX_RPS        ?? 0);  // 0 = unlimited
const OUTPUT_FILE = process.env.OUTPUT_FILE           ?? 'soak-report.json';

// ─── COLORS ────────────────────────────────────────────────────────────────────
const bold  = function(s) { return '\x1b[1m'  + s + '\x1b[0m'; };
const green = function(s) { return '\x1b[32m' + s + '\x1b[0m'; };
const red   = function(s) { return '\x1b[31m' + s + '\x1b[0m'; };
const cyan  = function(s) { return '\x1b[36m' + s + '\x1b[0m'; };
const gray  = function(s) { return '\x1b[90m' + s + '\x1b[0m'; };

if (!URLS.length) {
  console.log('\n' + bold('Usage:') + ' node soak-test.js <url1> [url2] ...');
  console.log(bold('Options:') + ' TOTAL=10000  CONCURRENCY=20  MIN_HTML_BYTES=5000  HTML_MARKER=  OUTPUT_FILE=\n');
  process.exit(1);
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────

async function fetchPage(url, extraHeaders) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        'Accept': 'text/html,*/*;q=0.9',
      }, extraHeaders || {}),
      redirect: 'follow',
    });
    const ct   = res.headers.get('content-type') || '';
    const body = await res.text();
    return {
      ok: true, status: res.status, contentType: ct,
      bytes: Buffer.byteLength(body, 'utf8'),
      ms: Date.now() - start,
      etag:      res.headers.get('etag'),
      lastMod:   res.headers.get('last-modified'),
      optlyEdge: res.headers.get('x-optly-edge') || null,
      preview:   body.slice(0, 300),
      // Check full body for structure/markers before discarding (memory-efficient)
      hasHtml:   body.includes('<html') || body.includes('<HTML'),
      hasMarker: HTML_MARKER ? body.includes(HTML_MARKER) : true,
    };
  } catch (err) {
    return { ok: false, error: err.message, ms: Date.now() - start };
  }
}

function isBlankPage(r) {
  if (!r.ok || r.status !== 200) return null;
  const ct = r.contentType.toLowerCase();
  if (!ct.includes('text/html')) return null;
  if (r.bytes < MIN_BYTES) return 'too small: ' + r.bytes + ' bytes';
  if (!r.hasHtml) return 'missing <html>';
  if (HTML_MARKER && !r.hasMarker) return 'missing marker: "' + HTML_MARKER + '"';
  return null;
}

// Rate limiter: each worker claims a time slot; if it's in the future, it waits.
function createThrottle(maxRps) {
  if (!maxRps || maxRps <= 0) return null;
  const intervalMs = 1000 / maxRps;
  let nextAllowed = Date.now();
  return function() {
    var now = Date.now();
    var mySlot = nextAllowed;
    nextAllowed = Math.max(now, nextAllowed) + intervalMs;
    var waitMs = mySlot - now;
    if (waitMs <= 0) return Promise.resolve();
    return new Promise(function(resolve) { setTimeout(resolve, waitMs); });
  };
}

async function runConcurrent(tasks, limit, throttle) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      if (throttle) await throttle();
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

function pct(sorted, p) {
  return sorted[Math.floor(sorted.length * p)] || 0;
}

function miniBar(val, max, width) {
  width = width || 20;
  const n = max > 0 ? Math.round((val / max) * width) : 0;
  return '\u2588'.repeat(n) + '\u2591'.repeat(width - n);
}

// ─── PRIME: get caching tokens for each URL ───────────────────────────────────

console.log('\n' + bold('═══════════════════════════════════════════════════════'));
console.log(bold('  Optimizely Edge Delivery — Volume / Soak Test'));
console.log(bold('═══════════════════════════════════════════════════════'));
console.log(gray('  ' + TOTAL.toLocaleString() + ' requests across ' + URLS.length + ' URL(s)  |  ' + CONCURRENCY + ' concurrent workers' + (MAX_RPS > 0 ? '  |  Max ' + MAX_RPS + ' req/s' : '') + '\n'));

process.stdout.write('  Priming cache tokens ... ');
const tokens = {};
for (const url of URLS) {
  const r = await fetchPage(url);
  tokens[url] = { etag: r.etag || null, lastMod: r.lastMod || null };
}
console.log(green('done'));

// ─── BUILD TASK LIST ──────────────────────────────────────────────────────────
// Mix: 2/3 returning visitors (send cache headers), 1/3 fresh visitors
const taskDefs = [];
for (let i = 0; i < TOTAL; i++) {
  taskDefs.push({
    url: URLS[i % URLS.length],
    isReturning: (i % 3 !== 0),
    idx: i,
  });
}

// ─── COUNTERS ─────────────────────────────────────────────────────────────────
const counts = { done: 0, ok200: 0, non200: 0, errors: 0, blank: 0 };
const statusDist  = {};
const optlyDist   = {};
const responseTimes = [];
const blankSamples  = [];
const errorSamples  = [];
const startTime = Date.now();
let lastPrint = 0;

// ─── RUN ──────────────────────────────────────────────────────────────────────
const runnableTasks = taskDefs.map(function(def) {
  return async function() {
    const { url, isReturning, idx } = def;
    const t = tokens[url];
    const condHeaders = {};
    if (isReturning && t.etag)    condHeaders['If-None-Match']    = t.etag;
    if (isReturning && t.lastMod) condHeaders['If-Modified-Since'] = t.lastMod;

    const r = await fetchPage(url, condHeaders);
    counts.done++;

    if (!r.ok) {
      counts.errors++;
      if (errorSamples.length < 5) errorSamples.push({ idx, url, error: r.error });
      return;
    }

    responseTimes.push(r.ms);
    statusDist[r.status] = (statusDist[r.status] || 0) + 1;
    if (r.status === 200) counts.ok200++; else counts.non200++;

    if (r.optlyEdge) {
      optlyDist[r.optlyEdge] = (optlyDist[r.optlyEdge] || 0) + 1;
    }

    const blankReason = isBlankPage(r);
    if (blankReason) {
      counts.blank++;
      if (blankSamples.length < 5)
        blankSamples.push({ idx, url, reason: blankReason, bytes: r.bytes, isReturning });
    }

    const now = Date.now();
    if (counts.done % 500 === 0 && now - lastPrint > 500) {
      lastPrint = now;
      const elapsed = ((now - startTime) / 1000).toFixed(1);
      const rps = (counts.done / ((now - startTime) / 1000)).toFixed(0);
      process.stdout.write(
        '\r  ' + counts.done.toLocaleString() + '/' + TOTAL.toLocaleString() +
        '  ' + elapsed + 's  ' + rps + ' req/s' +
        '  blank: ' + counts.blank + '  errors: ' + counts.errors + '   '
      );
    }
  };
});

var throttle = createThrottle(MAX_RPS);
await runConcurrent(runnableTasks, CONCURRENCY, throttle);
const totalMs = Date.now() - startTime;
process.stdout.write('\n');

// ─── STATS ────────────────────────────────────────────────────────────────────
const sorted = responseTimes.slice().sort(function(a, b) { return a - b; });
const mean = sorted.length ? Math.round(sorted.reduce(function(a, b) { return a + b; }, 0) / sorted.length) : 0;
const p50 = pct(sorted, 0.50);
const p90 = pct(sorted, 0.90);
const p95 = pct(sorted, 0.95);
const p99 = pct(sorted, 0.99);
const passed = counts.blank === 0 && counts.errors === 0;

// ─── PRINT RESULTS ────────────────────────────────────────────────────────────
console.log('\n' + bold('═══════════════════════════════════════════════════════'));
console.log(bold('  RESULTS'));
console.log(bold('═══════════════════════════════════════════════════════') + '\n');
console.log(bold('  Volume'));
console.log('  Total requests:   ' + TOTAL.toLocaleString());
console.log('  Duration:         ' + (totalMs / 1000).toFixed(1) + 's');
console.log('  Throughput:       ' + (counts.done / (totalMs / 1000)).toFixed(1) + ' req/s\n');

console.log(bold('  Response Codes'));
for (const code of Object.keys(statusDist).sort()) {
  const n   = statusDist[code];
  const pct2 = ((n / counts.done) * 100).toFixed(1);
  const c   = code.startsWith('2') ? green(code) : code.startsWith('3') ? gray(code) : red(code);
  console.log('  ' + c + ':  ' + n.toLocaleString() + ' (' + pct2 + '%)  ' + miniBar(n, counts.done));
}

console.log('\n' + bold('  Safety Checks'));
console.log('  Blank-page detections: ' + (counts.blank  === 0 ? green('0  PASS') : red(counts.blank  + '  FAIL')));
console.log('  Network errors:        ' + (counts.errors === 0 ? green('0  PASS') : red(counts.errors + '  FAIL')));

console.log('\n' + bold('  Response Times'));
console.log('  Mean: ' + mean + 'ms   p50: ' + p50 + 'ms   p90: ' + p90 + 'ms   p95: ' + p95 + 'ms   p99: ' + p99 + 'ms');

if (Object.keys(optlyDist).length > 0) {
  console.log('\n' + bold('  x-optly-edge Header Breakdown'));
  for (const k of Object.keys(optlyDist)) {
    const n   = optlyDist[k];
    const pct3 = ((n / counts.done) * 100).toFixed(1);
    console.log('  ' + cyan(k) + ': ' + n.toLocaleString() + ' (' + pct3 + '%)');
  }
}

if (blankSamples.length > 0) {
  console.log(red('\n  BLANK-PAGE SAMPLES:'));
  for (const s of blankSamples) {
    console.log(red('    [' + s.idx + '] ' + s.url + '  reason: ' + s.reason + '  bytes: ' + s.bytes));
  }
}

if (errorSamples.length > 0) {
  console.log(red('\n  NETWORK ERROR SAMPLES:'));
  for (const s of errorSamples) {
    console.log(red('    [' + s.idx + '] ' + s.url + '  ' + s.error));
  }
}

console.log('');
if (passed) {
  console.log(bold(green('  SOAK TEST PASSED — Zero blank pages across ' + TOTAL.toLocaleString() + ' requests')));
} else {
  console.log(bold(red('  SOAK TEST FAILED — Review issues above')));
}

// ─── SAVE REPORT ──────────────────────────────────────────────────────────────
const report = {
  generatedAt:     new Date().toISOString(),
  config:          { total: TOTAL, concurrency: CONCURRENCY, minHtmlBytes: MIN_BYTES, htmlMarker: HTML_MARKER || null },
  urls:            URLS,
  passed,
  counts,
  statusDistribution: statusDist,
  optlyHeaderDist: optlyDist,
  responseTimes:   { mean, p50, p90, p95, p99 },
  blankSamples,
  errorSamples,
  durationSeconds: (totalMs / 1000).toFixed(1),
  throughputRps:   (counts.done / (totalMs / 1000)).toFixed(1),
};

writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
console.log(gray('\n  Report saved to: ' + OUTPUT_FILE));

process.exit(passed ? 0 : 1);

})();
