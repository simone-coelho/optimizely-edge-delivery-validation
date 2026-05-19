/**
 * Optimizely Edge Delivery — Validation Harness (Phase 1)
 * ═══════════════════════════════════════════════════════
 * Tests the specific blank-page scenario caused by browser caching (304 responses).
 *
 * WHAT THIS DOES:
 *   1. Visits each URL like a brand-new visitor (collects ETag / Last-Modified)
 *   2. Re-visits like a returning visitor (sends those tokens back — triggers 304 risk)
 *   3. Checks that every response is a full page, never blank
 *   4. Writes a pass/fail JSON report you can share with the customer
 *
 * USAGE:
 *   node validate-edge.js https://customer-site.com/page1 https://customer-site.com/page2
 *
 * OPTIONS (environment variables):
 *   ITERS=200           Returning-visitor cycles per URL       (default: 200)
 *   MIN_HTML_BYTES=5000 Min bytes to consider a page "full"    (default: 5000)
 *   HTML_MARKER=        An HTML string that MUST appear        (e.g. 'id="app"')
 *   OPTLY_DEBUG=1       Check for x-optly-edge response header (default: off)
 *   CONCURRENCY=5       Parallel requests                       (default: 5)
 *   OUTPUT_FILE=        Save JSON results here                  (default: edge-validation-report.json)
 *
 * REQUIREMENTS: Node.js 18+  (no npm install needed)
 */

'use strict';
const { writeFileSync } = require('fs');

(async () => {

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const URLS        = process.argv.slice(2).filter(a => a.startsWith('http'));
const ITERS       = Number(process.env.ITERS            ?? 200);
const MIN_BYTES   = Number(process.env.MIN_HTML_BYTES   ?? 5000);
const HTML_MARKER = process.env.HTML_MARKER             ?? '';
const DEBUG_HDR   = process.env.OPTLY_DEBUG             === '1';
const CONCURRENCY = Number(process.env.CONCURRENCY      ?? 5);
const MAX_RPS     = Number(process.env.MAX_RPS           ?? 0);  // 0 = unlimited
const OUTPUT_FILE = process.env.OUTPUT_FILE             ?? 'edge-validation-report.json';

// ─── COLORS ────────────────────────────────────────────────────────────────────
const bold   = s => `\x1b[1m${s}\x1b[0m`;
const green  = s => `\x1b[32m${s}\x1b[0m`;
const red    = s => `\x1b[31m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const cyan   = s => `\x1b[36m${s}\x1b[0m`;
const gray   = s => `\x1b[90m${s}\x1b[0m`;

// ─── USAGE GUARD ───────────────────────────────────────────────────────────────
if (!URLS.length) {
  console.log(`
${bold('Optimizely Edge Delivery — Validation Harness')}

${bold('Usage:')}
  node validate-edge.js <url1> [url2] [url3] ...

${bold('Examples:')}
  node validate-edge.js https://www.yoursite.com/
  node validate-edge.js https://www.yoursite.com/ https://www.yoursite.com/pricing

${bold('Options (set as environment variables before the command):')}
  ITERS=500             Returning-visitor cycles per URL     (default: 200)
  MIN_HTML_BYTES=8000   Min bytes to consider a full page    (default: 5000)
  HTML_MARKER=id="app"  HTML string that must appear         (default: none)
  OPTLY_DEBUG=1         Check x-optly-edge response header   (default: off)
  CONCURRENCY=10        Parallel requests                     (default: 5)
  OUTPUT_FILE=out.json  Save JSON report here                 (default: edge-validation-report.json)
`);
  process.exit(1);
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────

async function fetchPage(url, extraHeaders) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }, extraHeaders || {}),
      redirect: 'follow',
    });
    const contentType = res.headers.get('content-type') || '';
    const body = await res.text();
    return {
      ok: true,
      status: res.status,
      contentType,
      body,
      bytes: Buffer.byteLength(body, 'utf8'),
      ms: Date.now() - start,
      etag:      res.headers.get('etag'),
      lastMod:   res.headers.get('last-modified'),
      optlyEdge: res.headers.get('x-optly-edge') || null,
    };
  } catch (err) {
    return { ok: false, error: err.message, ms: Date.now() - start };
  }
}

// Returns null if page is fine, or a string describing why it looks blank
function blankPageReason(r) {
  if (!r.ok) return `Network error: ${r.error}`;
  if (r.status !== 200) return null; // non-200 is a different issue, not "blank page"
  const ct = r.contentType.toLowerCase();
  if (!ct.includes('text/html')) return null; // not HTML — skip
  if (r.bytes < MIN_BYTES)
    return `Body too small: ${r.bytes} bytes (minimum: ${MIN_BYTES})`;
  if (!r.body.includes('<html') && !r.body.includes('<HTML'))
    return 'Missing <html> tag';
  if (!r.body.includes('</body>') && !r.body.includes('</BODY>'))
    return 'Missing </body> closing tag';
  if (HTML_MARKER && !r.body.includes(HTML_MARKER))
    return `Missing required marker: "${HTML_MARKER}"`;
  return null;
}

// Rate limiter: each worker claims a time slot; if it's in the future, it waits.
// Single-threaded JS means no actual race on nextAllowed.
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

function progressBar(done, total, width) {
  width = width || 30;
  const filled = Math.round((done / total) * width);
  return '[' + '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled) + '] ' + done + '/' + total;
}

// ─── TEST ONE URL ──────────────────────────────────────────────────────────────

async function testUrl(url) {
  console.log('\n' + bold(cyan('Testing: ')) + url);
  console.log(gray('  Iterations: ' + ITERS + '  |  Min HTML: ' + MIN_BYTES + ' bytes  |  Concurrency: ' + CONCURRENCY + (MAX_RPS > 0 ? '  |  Max RPS: ' + MAX_RPS : '')));

  const stats = {
    url,
    firstVisit:     { ok: 0, errors: 0, blankRisks: [] },
    returningVisit: { ok: 0, non200: 0, errors: 0, blankRisks: [] },
    responseTimes:  [],
    optlyHeaders:   {},
    cacheTokensFound: { etag: false, lastModified: false },
    samples: [],
  };

  // Step 1: Baseline first visit
  process.stdout.write(gray('  Step 1/2: First-visit baseline ... '));
  const baseline = await fetchPage(url);

  if (!baseline.ok) {
    console.log(red('FAILED — ' + baseline.error));
    stats.firstVisit.errors++;
    return stats;
  }

  const blankCheck = blankPageReason(baseline);
  if (blankCheck) {
    console.log(red('BLANK-RISK on first visit — ' + blankCheck));
    stats.firstVisit.blankRisks.push({ reason: blankCheck, bytes: baseline.bytes });
  } else {
    console.log(
      green('OK') +
      gray(' (' + baseline.bytes.toLocaleString() + ' bytes, ' + baseline.ms + 'ms, HTTP ' + baseline.status + ')')
    );
  }
  stats.firstVisit.ok++;
  stats.responseTimes.push(baseline.ms);
  stats.cacheTokensFound.etag         = !!baseline.etag;
  stats.cacheTokensFound.lastModified = !!baseline.lastMod;

  console.log(gray(
    '  Cache tokens found:  ETag=' + (baseline.etag    ? green('yes') : yellow('none')) +
    '   Last-Modified=' + (baseline.lastMod ? green('yes') : yellow('none'))
  ));

  if (!baseline.etag && !baseline.lastMod) {
    console.log(yellow(
      '  Note: No ETag or Last-Modified headers found on this URL.\n' +
      '  The returning-visitor caching scenario may not apply here — still running checks.'
    ));
  }

  // Step 2: Returning-visitor simulation
  console.log(gray('  Step 2/2: Returning-visitor simulation (' + ITERS + ' cycles)...'));

  let done = 0;
  const tasks = Array.from({ length: ITERS }, function(_, i) {
    return async function() {
      const condHeaders = {};
      if (baseline.etag)    condHeaders['If-None-Match']    = baseline.etag;
      if (baseline.lastMod) condHeaders['If-Modified-Since'] = baseline.lastMod;
      if (DEBUG_HDR)        condHeaders['X-Optly-Debug']    = '1';

      const r = await fetchPage(url, condHeaders);
      done++;
      if (done % 25 === 0 || done === ITERS) {
        process.stdout.write('\r  ' + progressBar(done, ITERS) + '   ');
      }
      return { i, r };
    };
  });

  const throttle = createThrottle(MAX_RPS);
  const results = await runConcurrent(tasks, CONCURRENCY, throttle);
  process.stdout.write('\n');

  for (const item of results) {
    const r = item.r;
    const i = item.i;

    if (!r.ok) {
      stats.returningVisit.errors++;
      if (stats.samples.length < 5)
        stats.samples.push({ iter: i, type: 'network-error', error: r.error });
      continue;
    }

    stats.responseTimes.push(r.ms);

    if (r.status === 200) {
      stats.returningVisit.ok++;
    } else {
      stats.returningVisit.non200++;
      // A 304 leaking through means conditional headers weren't stripped — the fix may not be applied
      if (r.status === 304 && stats.samples.length < 5) {
        stats.samples.push({
          iter: i, type: '304-leak',
          note: 'Server returned 304 to the edge worker — conditional header stripping (Layer B) may not be active'
        });
      }
    }

    if (r.optlyEdge) {
      stats.optlyHeaders[r.optlyEdge] = (stats.optlyHeaders[r.optlyEdge] || 0) + 1;
    }

    const blank = blankPageReason(r);
    if (blank) {
      stats.returningVisit.blankRisks.push({
        iter: i, reason: blank,
        status: r.status, bytes: r.bytes, contentType: r.contentType,
        preview: r.body.slice(0, 200),
      });
      if (stats.samples.length < 5)
        stats.samples.push({ iter: i, type: 'blank-risk', reason: blank, bytes: r.bytes, status: r.status });
    }
  }

  // Per-URL result
  const totalBlank  = stats.firstVisit.blankRisks.length + stats.returningVisit.blankRisks.length;
  const totalErrors = stats.firstVisit.errors + stats.returningVisit.errors;
  const passed      = totalBlank === 0 && totalErrors === 0;

  const sorted = stats.responseTimes.slice().sort(function(a, b) { return a - b; });
  const p50 = sorted[Math.floor(sorted.length * 0.50)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  stats.summary = { passed, totalBlank, totalErrors, p50ms: p50, p95ms: p95 };

  console.log('\n  Result: ' + (passed ? green('PASS') : red('FAIL')));
  console.log(gray('  Returning-visitor 200s:  ' + stats.returningVisit.ok + '/' + ITERS));
  console.log(gray('  Non-200 responses:       ' + stats.returningVisit.non200 + (stats.returningVisit.non200 > 0 ? red(' (check for 304 leaks)') : '')));
  console.log(gray('  Network errors:          ' + totalErrors));
  console.log(gray('  Blank-page detections:   ' + (totalBlank === 0 ? green('0') : red(totalBlank))));
  console.log(gray('  Response times:          p50=' + p50 + 'ms  p95=' + p95 + 'ms'));

  if (Object.keys(stats.optlyHeaders).length > 0) {
    console.log(gray('  x-optly-edge breakdown:'));
    for (const k of Object.keys(stats.optlyHeaders)) {
      console.log(gray('    ' + k + ': ' + stats.optlyHeaders[k]));
    }
  } else if (DEBUG_HDR) {
    console.log(yellow('  x-optly-edge header not seen — is debug mode deployed on this environment?'));
  }

  if (stats.returningVisit.blankRisks.length > 0) {
    console.log(red('\n  BLANK-PAGE DETECTIONS:'));
    for (const b of stats.returningVisit.blankRisks.slice(0, 3)) {
      console.log(red('    Iter ' + b.iter + ': ' + b.reason + ' | ' + b.bytes + ' bytes | HTTP ' + b.status));
      if (b.preview) console.log(gray('    Preview: ' + b.preview.slice(0, 120)));
    }
  }

  return stats;
}

// ─── RUN ALL URLS ─────────────────────────────────────────────────────────────

console.log('\n' + bold('═══════════════════════════════════════════════════════'));
console.log(bold('  Optimizely Edge Delivery — Validation Harness'));
console.log(bold('═══════════════════════════════════════════════════════'));
console.log(gray('  Simulating the exact caching scenario that caused the'));
console.log(gray('  blank-page incident. Zero detections = fix is working.\n'));

const allResults = [];
for (const url of URLS) {
  const result = await testUrl(url);
  allResults.push(result);
}

// Final summary
console.log('\n' + bold('═══════════════════════════════════════════════════════'));
console.log(bold('  OVERALL RESULTS'));
console.log(bold('═══════════════════════════════════════════════════════'));

let allPassed = true;
for (const r of allResults) {
  const s = r.summary;
  const icon = s && s.passed ? green('PASS') : red('FAIL');
  console.log('  [' + icon + ']  ' + r.url);
  if (s) {
    if (s.totalBlank  > 0) console.log(red('          ' + s.totalBlank + ' blank-page detection(s)'));
    if (s.totalErrors > 0) console.log(red('          ' + s.totalErrors + ' network error(s)'));
    if (!s.passed) allPassed = false;
  }
}

console.log('');
if (allPassed) {
  console.log(bold(green('  ALL TESTS PASSED — Safe to proceed to Phase 3 (Internal Preview)')));
} else {
  console.log(bold(red('  FAILURES DETECTED — Review issues above before proceeding')));
}

const report = {
  generatedAt:  new Date().toISOString(),
  config:       { iters: ITERS, minHtmlBytes: MIN_BYTES, htmlMarker: HTML_MARKER || null, concurrency: CONCURRENCY },
  passed:       allPassed,
  urls:         allResults,
};
writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
console.log(gray('\n  Full report saved to: ' + OUTPUT_FILE));

process.exit(allPassed ? 0 : 1);

})();
