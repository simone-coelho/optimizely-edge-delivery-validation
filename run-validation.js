#!/usr/bin/env node
/**
 * Optimizely Edge Validation Kit — Run Orchestrator
 * ══════════════════════════════════════════════════
 * Runs validation phases against a customer domain using a profile config.
 * Each run is timestamped and cataloged for trend tracking and reporting.
 *
 * USAGE:
 *   node run-validation.js --profile profiles/example.json
 *   node run-validation.js --profile profiles/example.json --phase 1
 *   node run-validation.js --profile profiles/example.json --phase 2
 *   node run-validation.js --profile profiles/example.json --dry-run
 *
 * OPTIONS:
 *   --profile <path>   Path to customer profile JSON (required)
 *   --phase <1|2|all>  Which phase(s) to run (default: all)
 *   --dry-run          Show what would run without executing
 *   --skip-report      Skip markdown report generation
 *
 * REQUIREMENTS: Node.js 18+  (no npm install needed)
 */

'use strict';

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const { resolve, join } = require('path');
const { spawn } = require('child_process');

const KIT_DIR = __dirname;

// ─── COLORS ──────────────────────────────────────────────────────────────────
const bold   = s => `\x1b[1m${s}\x1b[0m`;
const green  = s => `\x1b[32m${s}\x1b[0m`;
const red    = s => `\x1b[31m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const cyan   = s => `\x1b[36m${s}\x1b[0m`;
const gray   = s => `\x1b[90m${s}\x1b[0m`;

// ─── CLI ARGS ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { profile: null, phase: 'all', dryRun: false, skipReport: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--profile':      opts.profile = args[++i]; break;
      case '--phase':        opts.phase = args[++i]; break;
      case '--dry-run':      opts.dryRun = true; break;
      case '--skip-report':  opts.skipReport = true; break;
      case '--help': case '-h':
        printUsage(); process.exit(0);
    }
  }

  if (!opts.profile) { printUsage(); process.exit(1); }
  return opts;
}

function printUsage() {
  console.log(`
${bold('Optimizely Edge Validation Kit — Run Orchestrator')}

${bold('Usage:')}
  node run-validation.js --profile <profile.json> [options]

${bold('Options:')}
  --profile <path>   Customer profile JSON (required)
  --phase <1|2|all>  Phase: 1 (functional), 2 (soak), all (default: all)
  --dry-run          Show commands without executing
  --skip-report      Skip markdown report generation
  --help             Show this help

${bold('Examples:')}
  node run-validation.js --profile profiles/example.json
  node run-validation.js --profile profiles/example.json --phase 1
  node run-validation.js --profile profiles/example.json --dry-run
`);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function loadProfile(profilePath) {
  const fullPath = resolve(KIT_DIR, profilePath);
  if (!existsSync(fullPath)) {
    console.error(red(`Profile not found: ${fullPath}`));
    process.exit(1);
  }
  return JSON.parse(readFileSync(fullPath, 'utf8'));
}

function createRunDir(profile) {
  const now = new Date();
  // Format: 20260312T143052Z
  const ts = now.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

  const customerSlug = profile.outputDir ||
    profile.customer.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  const customerDir = join(KIT_DIR, customerSlug);
  const runDir = join(customerDir, 'runs', ts);
  mkdirSync(runDir, { recursive: true });
  return { customerDir, customerSlug, runDir, timestamp: ts };
}

function runScript(scriptName, urls, envOverrides) {
  return new Promise((res, rej) => {
    const child = spawn('node', [join(KIT_DIR, scriptName), ...urls], {
      env: { ...process.env, ...envOverrides },
      cwd: KIT_DIR,
      stdio: 'inherit',
    });
    child.on('close', (code) => res(code));
    child.on('error', (err) => rej(err));
  });
}

function updateRunIndex(customerDir, runEntry) {
  const indexPath = join(customerDir, 'runs-index.json');
  let index = { runs: [] };
  if (existsSync(indexPath)) {
    try { index = JSON.parse(readFileSync(indexPath, 'utf8')); } catch (e) {}
  }
  index.runs.push(runEntry);
  index.lastUpdated = new Date().toISOString();
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

(async () => {
  const startTime = Date.now();
  const opts = parseArgs();
  const profile = loadProfile(opts.profile);

  console.log('\n' + bold('══════════════════════════════════════════════════════════'));
  console.log(bold('  Optimizely Edge Validation Kit — Run Orchestrator'));
  console.log(bold('══════════════════════════════════════════════════════════'));
  console.log(gray(`  Customer:  ${profile.customer}`));
  console.log(gray(`  Domain:    ${profile.domain}`));
  console.log(gray(`  URLs:      ${profile.urls.length}`));
  for (const u of profile.urls) {
    console.log(gray(`             ${u}`));
  }
  console.log(gray(`  Phase(s):  ${opts.phase}`));
  if (opts.dryRun) console.log(yellow('\n  MODE: DRY RUN — no tests will execute'));
  console.log('');

  const { customerDir, customerSlug, runDir, timestamp } = createRunDir(profile);
  console.log(gray(`  Run ID:        ${timestamp}`));
  console.log(gray(`  Run directory: ${runDir}`));
  console.log('');

  // Save profile snapshot for reproducibility
  writeFileSync(join(runDir, 'profile-snapshot.json'), JSON.stringify(profile, null, 2));

  const runPhases = opts.phase === 'all' ? ['1', '2'] :
                    opts.phase === '1'   ? ['1']      :
                    opts.phase === '2'   ? ['2']      : [opts.phase];

  const results = { phase1: null, phase2: null };
  let overallPassed = true;

  // ─── PHASE 1 ──────────────────────────────────────────────────────────────
  if (runPhases.includes('1')) {
    const p1 = profile.phase1 || {};
    const outputFile = join(runDir, 'phase1-results.json');
    const env = {
      ITERS:          String(p1.iterations || 200),
      CONCURRENCY:    String(p1.concurrency || 5),
      MIN_HTML_BYTES: String(p1.minHtmlBytes || 5000),
      HTML_MARKER:    p1.htmlMarker || '',
      OUTPUT_FILE:    outputFile,
    };
    if (p1.optlyDebug) env.OPTLY_DEBUG = '1';
    if (p1.maxRps) env.MAX_RPS = String(p1.maxRps);

    console.log(bold(cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')));
    console.log(bold(cyan('  Phase 1: Functional Validation (Caching / Blank-Page Test)')));
    console.log(bold(cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')));

    if (opts.dryRun) {
      console.log(gray(`\n  Would run: node validate-edge.js ${profile.urls.join(' ')}`));
      console.log(gray(`  Config:  ITERS=${env.ITERS}  CONCURRENCY=${env.CONCURRENCY}  MIN_HTML_BYTES=${env.MIN_HTML_BYTES}${p1.maxRps ? '  MAX_RPS=' + p1.maxRps : ''}`));
      console.log(gray(`  Output:  ${outputFile}\n`));
    } else {
      const exitCode = await runScript('validate-edge.js', profile.urls, env);
      if (existsSync(outputFile)) {
        results.phase1 = JSON.parse(readFileSync(outputFile, 'utf8'));
      }
      if (exitCode !== 0) overallPassed = false;
      console.log('');
    }
  }

  // ─── PHASE 2 ──────────────────────────────────────────────────────────────
  if (runPhases.includes('2')) {
    const p2 = profile.phase2 || {};
    const outputFile = join(runDir, 'phase2-soak.json');
    const env = {
      TOTAL:          String(p2.total || 10000),
      CONCURRENCY:    String(p2.concurrency || 20),
      MIN_HTML_BYTES: String(p2.minHtmlBytes || 5000),
      HTML_MARKER:    p2.htmlMarker || '',
      OUTPUT_FILE:    outputFile,
    };
    if (p2.maxRps) env.MAX_RPS = String(p2.maxRps);

    console.log(bold(cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')));
    console.log(bold(cyan('  Phase 2: Volume / Soak Test')));
    console.log(bold(cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')));

    if (opts.dryRun) {
      console.log(gray(`\n  Would run: node soak-test.js ${profile.urls.join(' ')}`));
      console.log(gray(`  Config:  TOTAL=${env.TOTAL}  CONCURRENCY=${env.CONCURRENCY}  MIN_HTML_BYTES=${env.MIN_HTML_BYTES}${p2.maxRps ? '  MAX_RPS=' + p2.maxRps : ''}`));
      console.log(gray(`  Output:  ${outputFile}\n`));
    } else {
      const exitCode = await runScript('soak-test.js', profile.urls, env);
      if (existsSync(outputFile)) {
        results.phase2 = JSON.parse(readFileSync(outputFile, 'utf8'));
      }
      if (exitCode !== 0) overallPassed = false;
      console.log('');
    }
  }

  // ─── GENERATE REPORT ──────────────────────────────────────────────────────
  if (!opts.dryRun && !opts.skipReport) {
    console.log(gray('  Generating customer report...'));
    try {
      const generateReport = require('./generate-report');
      const reportPath = join(runDir, 'report.md');
      generateReport(profile, results, timestamp, reportPath);
      console.log(green(`  Report saved: ${reportPath}`));
    } catch (err) {
      console.log(yellow(`  Report generation failed: ${err.message}`));
    }
  }

  // ─── UPDATE INDEX ──────────────────────────────────────────────────────────
  if (!opts.dryRun) {
    const indexEntry = {
      timestamp,
      phases: runPhases,
      passed: overallPassed,
      urls: profile.urls,
      phase1Passed: results.phase1 ? results.phase1.passed : null,
      phase2Passed: results.phase2 ? results.phase2.passed : null,
    };
    updateRunIndex(customerDir, indexEntry);
  }

  // ─── FINAL SUMMARY ────────────────────────────────────────────────────────
  const elapsed = formatDuration(Date.now() - startTime);

  console.log('\n' + bold('══════════════════════════════════════════════════════════'));
  console.log(bold('  RUN COMPLETE'));
  console.log(bold('══════════════════════════════════════════════════════════'));

  if (opts.dryRun) {
    console.log(yellow('  Dry run — no tests were executed'));
  } else {
    const icon = overallPassed ? green('PASS') : red('FAIL');
    console.log(`  Overall:    [${icon}]`);
    if (results.phase1) {
      const p1Icon = results.phase1.passed ? green('PASS') : red('FAIL');
      console.log(`  Phase 1:    [${p1Icon}]  Functional validation`);
    }
    if (results.phase2) {
      const p2Icon = results.phase2.passed ? green('PASS') : red('FAIL');
      console.log(`  Phase 2:    [${p2Icon}]  Soak test`);
    }
    console.log(`  Duration:   ${elapsed}`);
    console.log(gray(`\n  Results:    ${runDir}`));
    if (!opts.skipReport) console.log(gray(`  Report:     ${join(runDir, 'report.md')}`));
    console.log(gray(`  Run index:  ${join(customerDir, 'runs-index.json')}`));
  }

  console.log('');
  process.exit(opts.dryRun ? 0 : (overallPassed ? 0 : 1));

})();
