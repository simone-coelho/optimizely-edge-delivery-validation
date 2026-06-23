/**
 * Mixed-traffic Organic Runner — alternates traffic profiles (e.g. real iOS
 * Safari/WebKit and normal desktop Chromium) one after the other, and fills a
 * target count for every (profile × variation) cell so the data lines up evenly.
 *
 *   # 6,000 mixed: 1,000 iOS + 1,000 web per variation, alternating
 *   node run-mix.js --config config/nasm-redirect.json --profiles ios,web --per-cell 1000
 *
 *   # 3,000 pure iOS: 1,000 per variation
 *   node run-mix.js --config config/nasm-redirect.json --profiles ios --per-cell 1000
 *
 * FLAGS:
 *   --profiles <list>  comma list of profiles to alternate: ios | web   (default ios,web)
 *   --per-cell <n>     target visits per (profile × variation) cell      (default 1000)
 *   --concurrency <n>  parallel visits across profiles                   (default 4)
 *   --delay <ms>       min gap between visit starts                      (default 750)
 *   --max-visits <n>   safety cap on attempts
 *   --resume <runDir>  continue a previous mixed run
 *
 * Pause: touch <runDir>/PAUSE  ·  Resume: rm it  ·  Stop: Ctrl-C (saves progress)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const playwright = require('playwright');
const { c, sleep, appendJsonl, safeWriteFile, pad, padL, makeStartGate } = require('./lib/util');
const { runVisit } = require('./lib/visit');

let lastProgWrite = 0;

const PROFILES = {
  ios: { label: 'iOS', engine: 'webkit', device: 'iPhone 13' },
  web: { label: 'Web', engine: 'chromium', device: null },
};

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--config' || t === '-c') a.config = argv[++i];
    else if (t === '--profiles') a.profiles = argv[++i];
    else if (t === '--per-cell') a.perCell = Number(argv[++i]);
    else if (t === '--concurrency') a.concurrency = Number(argv[++i]);
    else if (t === '--delay') a.delay = Number(argv[++i]);
    else if (t === '--max-visits') a.maxVisits = Number(argv[++i]);
    else if (t === '--resume') a.resume = argv[++i];
    else if (!t.startsWith('--') && !a.config) a.config = t;
  }
  return a;
}
function fail(m) { console.error('\n' + c.red('  ✗ ' + m) + '\n'); process.exit(1); }

(async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config) fail('Pass --config <path>');
  const cfgPath = path.resolve(args.config);
  if (!fs.existsSync(cfgPath)) fail('Config not found: ' + cfgPath);
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

  const perCell = args.perCell || 1000;
  const profKeys = (args.profiles || 'ios,web').split(',').map(s => s.trim()).filter(Boolean);
  const profiles = profKeys.map(k => { if (!PROFILES[k]) fail('Unknown profile "' + k + '" (use: ' + Object.keys(PROFILES).join(', ') + ')'); return PROFILES[k]; });
  const concurrency = args.concurrency || 4;
  const variations = cfg.variations;
  const maxVisits = args.maxVisits || perCell * profiles.length * variations.length * 2;
  const delay = args.delay != null ? args.delay : ((cfg.throttle && cfg.throttle.minDelayBetweenStartsMs) || 750);

  // Run dir (new or resumed).
  let runDir, counts;
  if (args.resume) {
    runDir = path.resolve(args.resume);
    counts = JSON.parse(fs.readFileSync(path.join(runDir, 'progress.json'), 'utf8')).counts;
    console.log(c.yellow('  Resuming ' + runDir));
  } else {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    runDir = path.join(path.dirname(cfgPath), '..', 'runs', 'mix-' + stamp);
    fs.mkdirSync(runDir, { recursive: true });
    counts = { attempts: 0, ok: 0, errors: 0, visitsWithEvents: 0, decisionEvents: 0, conversionEvents: 0, cells: {} };
    for (const p of profiles) { counts.cells[p.label] = {}; for (const v of variations) counts.cells[p.label][v.name] = 0; }
  }
  const visitsFile = path.join(runDir, 'visits.jsonl');
  const progressFile = path.join(runDir, 'progress.json');
  const pauseFile = path.join(runDir, 'PAUSE');

  console.log('\n' + c.bold('═══════════════════════════════════════════════════════════════'));
  console.log(c.bold('  Optimizely Web — Mixed-Traffic Organic Runner'));
  console.log(c.bold('═══════════════════════════════════════════════════════════════'));
  console.log(c.gray('  experiment : ') + (cfg.name || cfg.experimentId));
  console.log(c.gray('  profiles   : ') + profiles.map(p => p.label + ' (' + p.engine + (p.device ? '/' + p.device : '') + ')').join('  +  ') + c.gray('   (alternating)'));
  console.log(c.gray('  target     : ') + perCell.toLocaleString() + ' per cell × ' + (profiles.length * variations.length) + ' cells = ' + (perCell * profiles.length * variations.length).toLocaleString() + ' visits');
  console.log(c.gray('  throttle   : ') + concurrency + ' concurrent · ' + delay + 'ms gap   ' + c.gray('settle: ') + ((cfg.timing && cfg.timing.settleMs) || 6000) + 'ms');
  console.log(c.gray('  run dir    : ') + runDir);
  console.log(c.gray('  pause/resume: touch / rm ') + pauseFile + c.gray('   ·   stop: Ctrl-C'));
  console.log('');

  // One browser per distinct engine.
  const engines = Array.from(new Set(profiles.map(p => p.engine)));
  const browsers = {};
  for (const e of engines) {
    process.stdout.write(c.gray('  launching ' + e + ' … '));
    browsers[e] = await playwright[e].launch({ headless: true, args: e === 'chromium' ? ['--disable-blink-features=AutomationControlled'] : [] });
    console.log(c.green('ok'));
  }
  console.log('');

  let stopping = false;
  const onSig = () => { if (!stopping) { console.log(c.yellow('\n  Stopping — finishing in-flight visits, saving progress…')); stopping = true; } };
  process.on('SIGINT', onSig); process.on('SIGTERM', onSig);

  const gate = makeStartGate(delay, 0);
  const startTime = Date.now();
  let lastPrint = 0, profCursor = 0;

  const cellFull = p => variations.every(v => counts.cells[p.label][v.name] >= perCell);
  const allFull = () => profiles.every(cellFull);
  const done = () => stopping || allFull() || counts.attempts >= maxVisits;

  // Round-robin across profiles that still need data → alternating traffic.
  function nextProfile() {
    for (let i = 0; i < profiles.length; i++) {
      const p = profiles[profCursor++ % profiles.length];
      if (!cellFull(p)) return p;
    }
    return null;
  }

  function record(p, r) {
    counts.attempts++;
    if (r.ok) {
      counts.ok++;
      if (r.logxHits > 0) counts.visitsWithEvents++;
      counts.decisionEvents += r.decisionHits || 0;
      counts.conversionEvents += r.conversionHits || 0;
      if (r.variation) counts.cells[p.label][r.variation.name] = (counts.cells[p.label][r.variation.name] || 0) + 1;
    } else counts.errors++;
    appendJsonl(visitsFile, { t: new Date().toISOString(), profile: p.label, ok: r.ok, variation: r.variation ? r.variation.name : null, finalUrl: r.finalUrl, logxHits: r.logxHits, conversionHits: r.conversionHits, ms: r.ms, error: r.error || undefined });
    const now = Date.now();
    if (now - lastProgWrite > 1500) { lastProgWrite = now; safeWriteFile(progressFile, JSON.stringify({ updatedAt: new Date().toISOString(), perCell, profiles: profiles.map(p => p.label), counts }, null, 2)); }
  }

  function printProgress(force) {
    const now = Date.now();
    if (!force && now - lastPrint < 1500) return;
    lastPrint = now;
    const el = (now - startTime) / 1000, rate = counts.ok / Math.max(el, 0.001);
    const cellStr = profiles.map(p => p.label + '[' + variations.map(v => counts.cells[p.label][v.name]).join('/') + ']').join(' ');
    let remaining = 0;
    for (const p of profiles) for (const v of variations) remaining += Math.max(0, perCell - counts.cells[p.label][v.name]);
    const eta = rate > 0 ? '  ' + c.gray('ETA ~' + Math.ceil(remaining / rate / 60) + 'm') : '';
    process.stdout.write('\r  ' + c.gray(counts.attempts + ' ') + c.green(counts.ok + ' ok') + ' ' + (counts.errors ? c.red(counts.errors + ' err') : c.gray('0 err')) + '  ' + c.cyan(cellStr) + '  ' + c.gray(rate.toFixed(2) + '/s') + eta + '   ');
  }

  async function worker() {
    while (!done()) {
      while (fs.existsSync(pauseFile) && !stopping) await sleep(1000);
      if (done()) break;
      const p = nextProfile();
      if (!p) break;
      await gate();
      if (done()) break;
      const r = await runVisit(browsers[p.engine], cfg, { device: p.device });
      record(p, r);
      printProgress();
      if (counts.attempts >= 8 && counts.ok === 0) { stopping = true; console.log(c.red('\n  First 8 visits all failed — aborting. Run probe.js / probe-ios.js to diagnose.')); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  printProgress(true);
  process.stdout.write('\n');
  for (const e of engines) await browsers[e].close();

  // Flush final progress (throttling may have skipped the last few), then summary.
  safeWriteFile(progressFile, JSON.stringify({ updatedAt: new Date().toISOString(), perCell, profiles: profiles.map(p => p.label), counts }, null, 2));
  const summary = { startedAt: new Date(startTime).toISOString(), finishedAt: new Date().toISOString(), durationSec: ((Date.now() - startTime) / 1000).toFixed(1), perCell, profiles: profiles.map(p => p.label), reachedTarget: allFull(), counts };
  safeWriteFile(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n' + c.bold('  Results — bucketed visitors by traffic type × variation'));
  let header = '  ' + pad('', 8);
  for (const v of variations) header += padL(v.name, 14);
  header += padL('total', 10);
  console.log(c.bold(header));
  for (const p of profiles) {
    let row = '  ' + pad(p.label, 8), tot = 0;
    for (const v of variations) { const n = counts.cells[p.label][v.name]; tot += n; row += padL(n.toLocaleString(), 14); }
    console.log(row + padL(tot.toLocaleString(), 10));
  }
  let totRow = '  ' + pad('total', 8), grand = 0;
  for (const v of variations) { let cv = 0; for (const p of profiles) cv += counts.cells[p.label][v.name]; grand += cv; totRow += padL(cv.toLocaleString(), 14); }
  console.log(c.gray(totRow + padL(grand.toLocaleString(), 10)));
  console.log('');
  console.log('  ' + c.gray('ok: ') + counts.ok.toLocaleString() + '   ' + c.gray('errors: ') + counts.errors +
    '   ' + c.gray('visits w/ events: ') + counts.visitsWithEvents.toLocaleString() +
    '   ' + c.gray('decision/conv events: ') + counts.decisionEvents.toLocaleString() + '/' + counts.conversionEvents.toLocaleString());
  console.log('  ' + c.gray('duration: ') + summary.durationSec + 's   ' + c.gray('run dir: ') + runDir);
  console.log('');
  console.log(summary.reachedTarget ? c.bold(c.green('  ✓ All cells reached ' + perCell.toLocaleString() + '.')) :
    (stopping ? c.yellow('  ◼ Stopped early — resume: node run-mix.js --config ' + args.config + ' --profiles ' + profKeys.join(',') + ' --per-cell ' + perCell + ' --resume ' + runDir) : c.yellow('  ◼ Hit max attempts.')));
  console.log('');
  process.exit(0);
})().catch(err => fail(err && err.stack ? err.stack : String(err)));
