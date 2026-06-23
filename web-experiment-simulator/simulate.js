/**
 * Optimizely Web Experimentation — Synthetic Visitor Simulator
 * ═══════════════════════════════════════════════════════════════
 * Generates synthetic bucketing (campaign_activated) + conversion events for a
 * normal browser-snippet Web experiment and posts them to the Optimizely Event
 * API, so the Results page fills in across the days you choose (e.g. Sat / Sun /
 * today). It reproduces what the JS snippet does in a real browser — decide a
 * variation for a visitor, then report that decision (and any conversions) back
 * to Optimizely — but for N synthetic visitors at once, with controlled
 * timestamps so each event lands on the day you want.
 *
 * SAFETY: defaults to a DRY RUN. Nothing is sent until you pass --send.
 *
 * USAGE:
 *   node simulate.js --experiment experiments/example.json            # dry run
 *   node simulate.js --experiment experiments/example.json --send     # POST for real
 *   node simulate.js --experiment experiments/example.json --visitors 500
 *   node simulate.js --experiment experiments/example.json --seed 7 --dump
 *
 * FLAGS:
 *   --experiment <path>  Experiment manifest JSON (required)
 *   --send               Actually POST to Optimizely (omit = dry run)
 *   --visitors <n>       Override manifest visitor count
 *   --seed <n>           RNG seed for a reproducible population (default 1)
 *   --assignment <mode>  weighted | murmurhash (override manifest)
 *   --batch <n>          Visitors per request (default 500, keeps payload < 3.5MB)
 *   --concurrency <n>    Parallel requests when sending (default 6)
 *   --out <dir>          Output dir for the run record (default runs)
 *   --dump               Also write every generated payload to the run dir
 *
 * REQUIREMENTS: Node.js 18+  (no npm install — uses built-in fetch)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const U = require('./lib/util');
const { assignVariation, buildAllocations } = require('./lib/bucketing');
const { newVisitorId } = require('./lib/visitor');
const { makeTimeline, sampleActivation, sampleConversion } = require('./lib/timeline');
const EA = require('./lib/event-api');

// ─── arg parsing ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { send: false, dump: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--send') a.send = true;
    else if (t === '--dump') a.dump = true;
    else if (t === '--experiment' || t === '-e') a.experiment = argv[++i];
    else if (t === '--visitors') a.visitors = Number(argv[++i]);
    else if (t === '--seed') a.seed = Number(argv[++i]);
    else if (t === '--assignment') a.assignment = argv[++i];
    else if (t === '--batch') a.batch = Number(argv[++i]);
    else if (t === '--concurrency') a.concurrency = Number(argv[++i]);
    else if (t === '--out') a.out = argv[++i];
    else if (!t.startsWith('--') && !a.experiment) a.experiment = t;
  }
  return a;
}

function fail(msg) { console.error('\n' + U.red('  ✗ ' + msg) + '\n'); process.exit(1); }

function validateManifest(m) {
  const need = ['account_id', 'campaign_id', 'experiment_id', 'variations'];
  for (const k of need) if (m[k] == null) fail('Manifest is missing required field: ' + k);
  if (!Array.isArray(m.variations) || m.variations.length < 1) fail('variations[] must have at least one entry');
  for (const v of m.variations) if (v.id == null) fail('every variation needs an "id"');
  if (!m.dates || !Array.isArray(m.dates.days) || !m.dates.days.length) fail('dates.days[] is required');
  for (const metric of (m.metrics || [])) {
    if (metric.entity_id == null || metric.key == null) fail('every metric needs entity_id and key');
  }
}

(async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.experiment) fail('Pass --experiment <path>. e.g. node simulate.js --experiment experiments/example.json');

  const manPath = path.resolve(args.experiment);
  if (!fs.existsSync(manPath)) fail('Experiment manifest not found: ' + manPath);
  const m = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  validateManifest(m);

  const visitors = args.visitors || m.visitors || 10000;
  const seed = args.seed != null ? args.seed : (m.seed != null ? m.seed : 1);
  const mode = args.assignment || m.assignment || 'weighted';
  const batchSize = args.batch || m.batchSize || 500;
  const concurrency = args.concurrency || m.concurrency || 6;
  const outDir = args.out || m.outputDir || 'runs';
  const region = (m.region || 'US').toUpperCase();
  const endpoint = EA.endpointFor(region);
  const nowMs = Date.now();
  const rng = U.makeRng(seed);

  const tl = makeTimeline(m.dates, nowMs);
  const varById = {};
  for (const v of m.variations) varById[v.id] = v;
  const metrics = m.metrics || [];

  // ─── header ───────────────────────────────────────────────────────────────
  console.log('\n' + U.bold('═══════════════════════════════════════════════════════════════'));
  console.log(U.bold('  Optimizely Web — Synthetic Visitor Simulator'));
  console.log(U.bold('═══════════════════════════════════════════════════════════════'));
  console.log(U.gray('  experiment : ') + (m.name || m.experiment_id));
  console.log(U.gray('  visitors   : ') + visitors.toLocaleString() + '   ' +
    U.gray('assignment: ') + mode + '   ' + U.gray('seed: ') + seed);
  console.log(U.gray('  days       : ') + m.dates.days.join('  ') +
    (m.dates.diurnal !== false ? U.gray('  (diurnal curve)') : U.gray('  (uniform)')));
  console.log(U.gray('  region     : ') + region + '   ' + U.gray('endpoint: ') + endpoint);
  console.log(U.gray('  mode       : ') + (args.send ? U.red('LIVE SEND') : U.green('DRY RUN (no events sent)')));
  console.log('');

  if (mode === 'murmurhash') {
    const allocs = buildAllocations(m.variations);
    console.log(U.gray('  murmur traffic allocation (out of 10000): ') +
      allocs.map(function (a) { return (varById[a.id] ? varById[a.id].name : a.id) + '→' + a.end; }).join('  '));
    console.log('');
  }

  // ─── build the synthetic population ────────────────────────────────────────
  const seenIds = new Set();
  function uniqueVisitorId(aroundMs) {
    let id;
    do { id = newVisitorId(rng, aroundMs); } while (seenIds.has(id));
    seenIds.add(id);
    return id;
  }

  // per-variation + per-day + per-metric counters
  const byVar = {};
  for (const v of m.variations) byVar[v.id] = { name: v.name || v.id, visitors: 0, conv: {} };
  const byDay = {};
  for (const d of m.dates.days) byDay[d] = 0;
  let totalConversions = 0;

  const population = new Array(visitors);
  for (let i = 0; i < visitors; i++) {
    const act = sampleActivation(tl, rng);
    const visitorId = uniqueVisitorId(act.dayStartUtc);
    const variationId = assignVariation(visitorId, m, mode, rng);

    byVar[variationId] = byVar[variationId] || { name: varById[variationId] ? varById[variationId].name : variationId, visitors: 0, conv: {} };
    byVar[variationId].visitors++;
    byDay[act.date] = (byDay[act.date] || 0) + 1;

    const conversions = [];
    for (const metric of metrics) {
      const rate = (metric.rates && metric.rates[variationId] != null) ? metric.rates[variationId]
        : (metric.rate != null ? metric.rate : 0);
      if (rng() < rate) {
        const cts = sampleConversion(act.ts, m.conversion, rng, nowMs);
        let revenue = null;
        if (metric.revenueCents != null) {
          revenue = Array.isArray(metric.revenueCents)
            ? metric.revenueCents[0] + rng() * (metric.revenueCents[1] - metric.revenueCents[0])
            : metric.revenueCents;
        }
        conversions.push({ metric: metric, ts: cts, revenue: revenue });
        byVar[variationId].conv[metric.key] = (byVar[variationId].conv[metric.key] || 0) + 1;
        totalConversions++;
      }
    }
    population[i] = { visitorId: visitorId, variationId: variationId, activationTs: act.ts, conversions: conversions };
  }

  // ─── turn the population into Event API visitor objects ────────────────────
  const eventVisitors = population.map(function (p) {
    const snapshots = [EA.activationSnapshot(m, p.variationId, p.activationTs, U.uuid())];
    for (const c of p.conversions) {
      snapshots.push(EA.conversionSnapshot(c.metric, c.ts, U.uuid(), c.revenue));
    }
    return EA.buildVisitor(p.visitorId, snapshots, m.attributes);
  });
  const batches = U.chunk(eventVisitors, batchSize);

  // ─── summary table ─────────────────────────────────────────────────────────
  printSummary(m, byVar, byDay, metrics, visitors, totalConversions);

  const sampleBatch = EA.buildBatch(m, eventVisitors.slice(0, 2));
  const approxBytes = Buffer.byteLength(JSON.stringify(EA.buildBatch(m, batches[0] || [])), 'utf8');
  console.log(U.gray('  Batching   : ') + batches.length + ' request(s) × up to ' + batchSize +
    ' visitors   (~' + (approxBytes / 1024).toFixed(0) + ' KB/request, limit 3500 KB)');

  // ─── run record ────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const runDir = path.join(path.dirname(manPath), '..', outDir, stamp);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'manifest-snapshot.json'), JSON.stringify(m, null, 2));
  fs.writeFileSync(path.join(runDir, 'sample-payload.json'), JSON.stringify(sampleBatch, null, 2));
  const summary = {
    generatedAt: new Date().toISOString(),
    experiment: m.name || m.experiment_id,
    sent: !!args.send, region: region, endpoint: endpoint,
    visitors: visitors, seed: seed, assignment: mode,
    days: m.dates.days, perDay: byDay,
    perVariation: byVar, totalConversions: totalConversions,
    batches: batches.length, batchSize: batchSize,
  };

  if (args.dump) {
    const dumpDir = path.join(runDir, 'payloads');
    fs.mkdirSync(dumpDir, { recursive: true });
    batches.forEach(function (b, i) {
      fs.writeFileSync(path.join(dumpDir, 'batch-' + String(i + 1).padStart(4, '0') + '.json'),
        JSON.stringify(EA.buildBatch(m, b), null, 2));
    });
    console.log(U.gray('  Dumped ' + batches.length + ' payload(s) to ') + path.join(runDir, 'payloads'));
  }

  // ─── send (or not) ─────────────────────────────────────────────────────────
  if (!args.send) {
    console.log('\n' + U.green('  DRY RUN complete — no events were sent.'));
    console.log(U.gray('  Sample payload: ') + path.join(runDir, 'sample-payload.json'));
    console.log(U.gray('  Re-run with ') + U.bold('--send') + U.gray(' to POST these events to Optimizely.\n'));
    summary.result = 'dry-run';
    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  console.log('\n' + U.yellow('  Sending ' + batches.length + ' batch(es) to ' + endpoint + ' …'));
  const counts = { ok: 0, failed: 0, eventsSent: 0 };
  const failures = [];
  let done = 0;

  const tasks = batches.map(function (b, i) {
    return async function () {
      const payload = EA.buildBatch(m, b);
      const r = await EA.postBatch(endpoint, payload);
      done++;
      if (r.ok) {
        counts.ok++;
        // each visitor = 1 impression + its conversions
        for (const v of b) counts.eventsSent += v.snapshots.reduce(function (s, sn) { return s + (sn.events ? sn.events.length : 0); }, 0);
      } else {
        counts.failed++;
        if (failures.length < 5) failures.push({ batch: i + 1, status: r.status, error: r.error || r.body });
      }
      process.stdout.write('\r  ' + U.gray(done + '/' + batches.length + ' batches  ') +
        U.green(counts.ok + ' ok') + '  ' + (counts.failed ? U.red(counts.failed + ' failed') : U.gray('0 failed')) + '   ');
    };
  });
  await U.runConcurrent(tasks, concurrency);
  process.stdout.write('\n');

  const passed = counts.failed === 0;
  console.log('');
  if (passed) {
    console.log(U.bold(U.green('  ✓ Sent ' + counts.eventsSent.toLocaleString() + ' events for ' +
      visitors.toLocaleString() + ' visitors across ' + counts.ok + ' batches')));
    console.log(U.gray('  Allow a few minutes, then check the experiment Results page for ' + m.dates.days.join(' / ') + '.'));
  } else {
    console.log(U.bold(U.red('  ✗ ' + counts.failed + ' batch(es) failed')));
    for (const f of failures) console.log(U.red('    batch ' + f.batch + ': HTTP ' + f.status + '  ' + (f.error || '')));
  }

  summary.result = passed ? 'sent' : 'partial-failure';
  summary.send = counts;
  summary.failures = failures;
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(U.gray('\n  Run record: ' + runDir + '\n'));
  process.exit(passed ? 0 : 1);
})().catch(function (err) { fail(err && err.stack ? err.stack : String(err)); });

// ─── summary renderer ─────────────────────────────────────────────────────────
function printSummary(m, byVar, byDay, metrics, visitors, totalConversions) {
  console.log(U.bold('  Population'));
  console.log('  ' + U.gray('Total visitors: ') + visitors.toLocaleString() +
    '   ' + U.gray('Total conversion events: ') + totalConversions.toLocaleString());
  console.log('');

  // per-variation table
  const metricKeys = metrics.map(function (mm) { return mm.key; });
  let header = '  ' + U.pad('Variation', 22) + U.padL('Visitors', 10) + U.padL('Share', 8);
  for (const k of metricKeys) header += U.padL(k, 16) + U.padL('CR%', 8);
  console.log(U.bold(header));
  for (const v of m.variations) {
    const row = byVar[v.id] || { name: v.name || v.id, visitors: 0, conv: {} };
    let line = '  ' + U.pad((v.name || v.id), 22) + U.padL(row.visitors.toLocaleString(), 10) +
      U.padL(((row.visitors / visitors) * 100).toFixed(1) + '%', 8);
    for (const k of metricKeys) {
      const c = row.conv[k] || 0;
      const cr = row.visitors ? ((c / row.visitors) * 100).toFixed(2) + '%' : '—';
      line += U.padL(c.toLocaleString(), 16) + U.padL(cr, 8);
    }
    console.log(line);
  }
  console.log('');

  // per-day spread
  console.log(U.bold('  Per-day spread'));
  const maxDay = Math.max.apply(null, Object.keys(byDay).map(function (d) { return byDay[d]; }).concat([1]));
  for (const d of m.dates.days) {
    const n = byDay[d] || 0;
    const barN = Math.round((n / maxDay) * 28);
    console.log('  ' + U.pad(d, 14) + U.padL(n.toLocaleString(), 8) + '  ' +
      U.cyan('█'.repeat(barN)) + U.gray('░'.repeat(28 - barN)));
  }
  console.log('');
}
