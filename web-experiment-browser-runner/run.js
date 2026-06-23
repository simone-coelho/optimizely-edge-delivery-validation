/**
 * Optimizely Web Experimentation — Organic Browser Runner
 * ════════════════════════════════════════════════════════
 * Drives N REAL headless-browser visitors through the experiment so the live
 * snippet buckets each one, fires the redirect, loads the destination, and
 * dispatches the decision + conversion events organically. Governed: throttle,
 * pause/resume, graceful stop.
 *
 * USAGE:
 *   node run.js --config config/nasm-redirect.json --per-variation 1000
 *   node run.js --config config/nasm-redirect.json --total 3000 --concurrency 4 --delay 500
 *   node run.js --config config/nasm-redirect.json --total 3000 --max-per-minute 120
 *   node run.js --config config/nasm-redirect.json --resume runs/<stamp>
 *
 * FLAGS:
 *   --config <path>      Experiment config JSON (required)
 *   --per-variation <n>  Run until EACH variation reaches n bucketed visitors
 *   --total <n>          Run until n successful visits total
 *   --concurrency <n>    Parallel browser contexts (default from config, 4)
 *   --delay <ms>         Minimum gap between visit starts (throttle)
 *   --max-per-minute <n> Hard cap on visit starts per minute
 *   --max-visits <n>     Safety cap on total attempts
 *   --headed             Show the browser window
 *   --resume <runDir>    Continue a previous run's counts
 *
 * GOVERNANCE WHILE RUNNING:
 *   Pause : create a file named  PAUSE  inside the run directory
 *   Resume: delete that PAUSE file
 *   Stop  : Ctrl-C  (finishes in-flight visits, saves progress)
 *
 * REQUIREMENTS: npm install && npx playwright install chromium
 */
'use strict';

const fs = require('fs');
const path = require('path');
const playwright = require('playwright');
const { c, sleep, appendJsonl, safeWriteFile, pad, padL, makeStartGate } = require('./lib/util');
let lastProgWrite = 0;
const { runVisit } = require('./lib/visit');

function parseArgs(argv) {
  const a = { headed: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--config' || t === '-c') a.config = argv[++i];
    else if (t === '--per-variation') a.perVariation = Number(argv[++i]);
    else if (t === '--total') a.total = Number(argv[++i]);
    else if (t === '--concurrency') a.concurrency = Number(argv[++i]);
    else if (t === '--delay') a.delay = Number(argv[++i]);
    else if (t === '--max-per-minute') a.maxPerMinute = Number(argv[++i]);
    else if (t === '--max-visits') a.maxVisits = Number(argv[++i]);
    else if (t === '--headed') a.headed = true;
    else if (t === '--engine') a.engine = argv[++i];
    else if (t === '--device') a.device = argv[++i];
    else if (t === '--resume') a.resume = argv[++i];
    else if (!t.startsWith('--') && !a.config) a.config = t;
  }
  return a;
}

function fail(m) { console.error('\n' + c.red('  ✗ ' + m) + '\n'); process.exit(1); }

(async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config) fail('Pass --config <path>. e.g. node run.js --config config/nasm-redirect.json');
  const cfgPath = path.resolve(args.config);
  if (!fs.existsSync(cfgPath)) fail('Config not found: ' + cfgPath);
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

  // Apply CLI overrides.
  cfg.throttle = cfg.throttle || {};
  if (args.concurrency) cfg.throttle.concurrency = args.concurrency;
  if (args.delay != null) cfg.throttle.minDelayBetweenStartsMs = args.delay;
  if (args.maxPerMinute != null) cfg.throttle.maxPerMinute = args.maxPerMinute;
  cfg.target = cfg.target || {};
  if (args.perVariation) { cfg.target.mode = 'perVariation'; cfg.target.count = args.perVariation; }
  if (args.total) { cfg.target.mode = 'total'; cfg.target.count = args.total; }
  if (args.maxVisits) cfg.target.maxVisits = args.maxVisits;
  if (args.headed) cfg.browser = Object.assign({}, cfg.browser, { headless: false });
  if (args.engine) cfg.engine = args.engine;
  if (args.device) cfg.device = args.device;
  const engine = cfg.engine || 'chromium';

  const concurrency = cfg.throttle.concurrency || 4;
  const target = cfg.target;
  if (!target.count) fail('Set a target: --per-variation <n> or --total <n> (or in the config).');
  const maxVisits = target.maxVisits ||
    (target.mode === 'perVariation' ? target.count * cfg.variations.length * 3 : target.count * 3);

  // Run directory (new or resumed).
  let runDir, counts;
  if (args.resume) {
    runDir = path.resolve(args.resume);
    const prog = JSON.parse(fs.readFileSync(path.join(runDir, 'progress.json'), 'utf8'));
    counts = prog.counts;
    console.log(c.yellow('  Resuming ' + runDir));
  } else {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    runDir = path.join(path.dirname(cfgPath), '..', 'runs', stamp);
    fs.mkdirSync(runDir, { recursive: true });
    counts = { attempts: 0, ok: 0, errors: 0, blocked: 0, unknown: 0, byVariation: {}, decisionEvents: 0, conversionEvents: 0, visitsWithEvents: 0 };
    for (const v of cfg.variations) counts.byVariation[v.name] = 0;
  }
  const visitsFile = path.join(runDir, 'visits.jsonl');
  const progressFile = path.join(runDir, 'progress.json');
  const pauseFile = path.join(runDir, 'PAUSE');

  // Header.
  console.log('\n' + c.bold('═══════════════════════════════════════════════════════════════'));
  console.log(c.bold('  Optimizely Web — Organic Browser Runner'));
  console.log(c.bold('═══════════════════════════════════════════════════════════════'));
  console.log(c.gray('  experiment : ') + (cfg.name || cfg.experimentId));
  console.log(c.gray('  url        : ') + cfg.startUrl);
  console.log(c.gray('  target     : ') + (target.mode === 'perVariation'
    ? target.count.toLocaleString() + ' per variation (' + cfg.variations.length + ' variations)'
    : target.count.toLocaleString() + ' total') + c.gray('   max attempts: ') + maxVisits.toLocaleString());
  console.log(c.gray('  throttle   : ') + concurrency + ' concurrent  ·  ' +
    (cfg.throttle.minDelayBetweenStartsMs || 0) + 'ms min gap' +
    (cfg.throttle.maxPerMinute ? '  ·  ≤' + cfg.throttle.maxPerMinute + '/min' : ''));
  console.log(c.gray('  browser    : ') + engine + (cfg.device ? ' · ' + cfg.device : '') + '   ' +
    (cfg.browser && cfg.browser.headless === false ? 'headed' : 'headless') +
    '   ' + c.gray('settle: ') + ((cfg.timing && cfg.timing.settleMs) || 6000) + 'ms');
  console.log(c.gray('  run dir    : ') + runDir);
  console.log(c.gray('  pause/resume: touch / rm ') + path.join(runDir, 'PAUSE') + c.gray('   ·   stop: Ctrl-C'));
  console.log('');

  const browser = await playwright[engine].launch({
    headless: cfg.browser ? cfg.browser.headless !== false : true,
    args: engine === 'chromium' ? ['--disable-blink-features=AutomationControlled'] : [],
  });

  let stopping = false;
  const onSig = () => { if (!stopping) { console.log(c.yellow('\n  Stopping — finishing in-flight visits, saving progress…')); stopping = true; } };
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);

  const gate = makeStartGate(cfg.throttle.minDelayBetweenStartsMs || 0, cfg.throttle.maxPerMinute || 0);
  const startTime = Date.now();
  let lastPrint = 0;

  function targetMet() {
    if (target.mode === 'total') return counts.ok >= target.count;
    return cfg.variations.every(v => (counts.byVariation[v.name] || 0) >= target.count);
  }
  function done() { return stopping || targetMet() || counts.attempts >= maxVisits; }

  function record(r) {
    counts.attempts++;
    if (r.ok) {
      counts.ok++;
      if (r.logxHits > 0) counts.visitsWithEvents++;
      counts.decisionEvents += r.decisionHits || 0;
      counts.conversionEvents += r.conversionHits || 0;
      if (r.variation) counts.byVariation[r.variation.name] = (counts.byVariation[r.variation.name] || 0) + 1;
      else counts.unknown++;
    } else {
      counts.errors++;
      if (r.reached && !r.snippetPresent) counts.blocked++; // loaded the URL but no snippet → likely a wall/challenge
    }
    appendJsonl(visitsFile, {
      t: new Date().toISOString(),
      ok: r.ok, variation: r.variation ? r.variation.name : null,
      finalUrl: r.finalUrl, logxHits: r.logxHits, decisionHits: r.decisionHits,
      conversionHits: r.conversionHits, ms: r.ms, error: r.error || undefined,
      redirect: r.optState && r.optState.redirect ? true : undefined,
    });
    const now = Date.now();
    if (now - lastProgWrite > 1500) { lastProgWrite = now; safeWriteFile(progressFile, JSON.stringify({ updatedAt: new Date().toISOString(), config: path.basename(cfgPath), target, counts }, null, 2)); }
  }

  function printProgress(force) {
    const now = Date.now();
    if (!force && now - lastPrint < 1000) return;
    lastPrint = now;
    const el = (now - startTime) / 1000;
    const rate = counts.ok / Math.max(el, 0.001);
    const vstr = cfg.variations.map(v => {
      const short = v.name.replace('Variation ', 'V').replace('Control ', '');
      return short + ':' + (counts.byVariation[v.name] || 0);
    }).join('  ');
    let eta = '';
    if (rate > 0) {
      let remaining;
      if (target.mode === 'total') remaining = Math.max(0, target.count - counts.ok);
      else remaining = cfg.variations.reduce((s, v) => s + Math.max(0, target.count - (counts.byVariation[v.name] || 0)), 0);
      eta = '  ' + c.gray('ETA ~' + Math.ceil(remaining / rate / 60) + 'm');
    }
    process.stdout.write('\r  ' + c.gray(counts.attempts + ' visits  ') +
      c.green(counts.ok + ' ok') + '  ' +
      (counts.errors ? c.red(counts.errors + ' err') : c.gray('0 err')) + '  ' +
      c.cyan(vstr) + '  ' + c.gray(rate.toFixed(2) + '/s') + eta + '   ');
  }

  async function worker() {
    while (!done()) {
      while (fs.existsSync(pauseFile) && !stopping) { await sleep(1000); }
      if (done()) break;
      await gate();
      if (done()) break;
      const r = await runVisit(browser, cfg);
      record(r);
      printProgress();
      // Early bail if the site is clearly blocking automation.
      if (counts.attempts >= 6 && counts.ok === 0) {
        stopping = true;
        console.log(c.red('\n  First ' + counts.attempts + ' visits all failed — the site may be blocking automated browsers. Run probe.js --headed to diagnose.'));
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  printProgress(true);
  process.stdout.write('\n');
  await browser.close();

  // Summary.
  const reached = targetMet();
  const summary = {
    startedAt: new Date(startTime).toISOString(),
    finishedAt: new Date().toISOString(),
    durationSec: ((Date.now() - startTime) / 1000).toFixed(1),
    config: path.basename(cfgPath), target, reachedTarget: reached, counts,
  };
  safeWriteFile(progressFile, JSON.stringify({ updatedAt: new Date().toISOString(), config: path.basename(cfgPath), target, counts }, null, 2));
  safeWriteFile(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n' + c.bold('  Results'));
  console.log('  ' + c.gray('Bucketed visitors (organic):'));
  for (const v of cfg.variations) {
    console.log('    ' + pad(v.name, 14) + padL((counts.byVariation[v.name] || 0).toLocaleString(), 8));
  }
  console.log('  ' + c.gray('ok: ') + counts.ok.toLocaleString() +
    '   ' + c.gray('errors: ') + counts.errors +
    (counts.blocked ? c.red('  (blocked: ' + counts.blocked + ')') : '') +
    (counts.unknown ? c.yellow('  (no variation: ' + counts.unknown + ')') : ''));
  console.log('  ' + c.gray('visits that fired logx events: ') + counts.visitsWithEvents.toLocaleString() +
    '   ' + c.gray('decision events: ') + counts.decisionEvents.toLocaleString() +
    '   ' + c.gray('conversion events: ') + counts.conversionEvents.toLocaleString());
  console.log('  ' + c.gray('duration: ') + summary.durationSec + 's   ' + c.gray('run dir: ') + runDir);
  console.log('');
  console.log(reached ? c.bold(c.green('  ✓ Target reached.')) :
    (stopping ? c.yellow('  ◼ Stopped before target — resume with: node run.js --config ' + args.config + ' --resume ' + runDir)
      : c.yellow('  ◼ Hit max attempts before target.')));
  console.log(c.gray('  Allow a few minutes, then check the experiment Results page.\n'));
  process.exit(0);
})().catch(err => fail(err && err.stack ? err.stack : String(err)));
