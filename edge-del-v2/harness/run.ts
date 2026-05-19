// Harness orchestrator. Reads experiment cases, drives a Chromium instance
// through every (case × variant) combination, snapshots DOM + console +
// performance, scores each op, writes a timestamped run directory.
//
// Usage:
//   npm run run -- --worker https://edge-del-v2-worker.<acct>.workers.dev --case 04
//   npm run run -- --all
//   npm run run -- --case 04-additive-dom --variants reinforce-off,reinforce-on
//
// Required env:
//   WORKER_URL    Base URL of the deployed (or local) edge worker
//   ORIGIN_URL    Pages origin the worker is fronting (recorded in the report)

import { chromium, type Browser, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, exit } from 'node:process';
import { INIT_SCRIPT } from './lib/hydration-observer';
import { snapshotOps, type OpSnapshot } from './lib/dom-snapshot';
import { verifyOp, rollupOutcomes, type Outcome } from './lib/verify';
import { renderMarkdown, writeJson, type CaseRunRecord, type RunReport } from './lib/report';

// Import the eight cases directly — no fetch needed.
import case01 from '../experiments/01-text-content.json' assert { type: 'json' };
import case02 from '../experiments/02-attribute-only.json' assert { type: 'json' };
import case03 from '../experiments/03-css-class-toggle.json' assert { type: 'json' };
import case04 from '../experiments/04-additive-dom.json' assert { type: 'json' };
import case05 from '../experiments/05-rearrange-unkeyed.json' assert { type: 'json' };
import case06 from '../experiments/06-rearrange-keyed.json' assert { type: 'json' };
import case07 from '../experiments/07-stateful-subtree.json' assert { type: 'json' };
import case08 from '../experiments/08-combination.json' assert { type: 'json' };
import case09 from '../experiments/09-additive-into-vfor.json' assert { type: 'json' };
import case10 from '../experiments/10-reactive-binding.json' assert { type: 'json' };

import type { Case } from 'edge-del-v2-reinforce';
type ProperCase = Case & { ops: any[] };

const ALL_CASES: ProperCase[] = [
  case01 as any, case02 as any, case03 as any, case04 as any,
  case05 as any, case06 as any, case07 as any, case08 as any,
  case09 as any, case10 as any
];

type Variant = 'reinforce-off' | 'reinforce-on';
const ALL_VARIANTS: Variant[] = ['reinforce-off', 'reinforce-on'];

interface CliArgs {
  workerUrl: string;
  originUrl: string;
  selectedCases: ProperCase[];
  variants: Variant[];
  headed: boolean;
}

function parseArgs(): CliArgs {
  const env = process.env;
  const args = argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const has = (flag: string): boolean => args.includes(flag);

  const workerUrl = get('--worker') || env.WORKER_URL || '';
  const originUrl = get('--origin') || env.ORIGIN_URL || '';
  if (!workerUrl) {
    console.error('Missing --worker <url> or WORKER_URL env var.');
    exit(2);
  }

  const caseArg = get('--case');
  let selectedCases: ProperCase[];
  if (has('--all') || !caseArg) {
    selectedCases = ALL_CASES;
  } else {
    const m = ALL_CASES.find(c => c.id === caseArg || c.id.startsWith(caseArg + '-') || c.id.startsWith(caseArg));
    if (!m) { console.error(`Unknown case ${caseArg}`); exit(2); }
    selectedCases = [m];
  }

  const variantsArg = get('--variants');
  const variants: Variant[] = variantsArg
    ? (variantsArg.split(',').filter(v => ALL_VARIANTS.includes(v as Variant)) as Variant[])
    : ALL_VARIANTS;

  return {
    workerUrl,
    originUrl: originUrl || '(not recorded)',
    selectedCases,
    variants,
    headed: has('--headed')
  };
}

function urlFor(workerUrl: string, c: ProperCase, variant: Variant): string {
  const u = new URL(c.pathMatch === '*' ? '/' : c.pathMatch, workerUrl);
  u.searchParams.set('case', c.id);
  u.searchParams.set('reinforce', variant === 'reinforce-on' ? 'on' : 'off');
  // Bust any CDN cache between runs.
  u.searchParams.set('__t', Date.now().toString());
  return u.toString();
}

async function runOne(browser: Browser, args: CliArgs, c: ProperCase, variant: Variant): Promise<CaseRunRecord> {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 EdgeDelV2Harness/1.0 (Playwright)'
  });
  await ctx.addInitScript({ content: INIT_SCRIPT });
  const page = await ctx.newPage();
  const url = urlFor(args.workerUrl, c, variant);
  let workerHeader: string | null = null;

  page.on('response', resp => {
    if (resp.url() === url || resp.url().split('?')[0] === url.split('?')[0]) {
      const h = resp.headers()['x-edge-del-v2'];
      if (h) workerHeader = h;
    }
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    // Give the companion (if any) time to fire after hydration.
    await page.waitForFunction(
      () => !!(window as any).__edgeDelV2Harness,
      undefined,
      { timeout: 5_000 }
    );
    // For reinforce-on, wait for the companion's reapply:done event;
    // for reinforce-off, just wait a small settle period.
    if (variant === 'reinforce-on') {
      await page.waitForFunction(
        () => {
          const bus = (window as any).__edgeDelV2Harness;
          return bus && Array.isArray(bus.companionEvents) &&
            bus.companionEvents.some((e: any) =>
              e?.detail?.kind === 'reapply:done' || e?.detail?.kind === 'boot:no-manifest' || e?.detail?.kind === 'boot:sdk-sentinel'
            );
        },
        undefined,
        { timeout: 5_000 }
      ).catch(() => { /* companion may be absent in reinforce-off */ });
    } else {
      await page.waitForTimeout(400);
    }

    const snaps: OpSnapshot[] = await snapshotOps(page, c.id, c.ops);
    const opOutcomes: Outcome[] = snaps.map((s, i) => verifyOp(c.ops[i], s));
    const rollup = rollupOutcomes(opOutcomes);

    const bus = await page.evaluate(() => (window as any).__edgeDelV2Harness);
    const perf = bus?.perf || {};
    const vueWarnings: Array<{ at: number; msg: string }> = bus?.vueWarnings || [];
    const companionEvents: any[] = bus?.companionEvents || [];

    const expected = variant === 'reinforce-on' ? c.expected.withReinforcement : c.expected.withoutReinforcement;
    const pass = rollup === expected;

    return {
      caseId: c.id,
      caseName: c.name,
      bucket: c.bucket,
      page: c.pathMatch,
      variant,
      url,
      workerHeader,
      hydration: {
        vueWarnings: vueWarnings.length,
        sampleWarnings: vueWarnings.slice(0, 5).map(w => w.msg),
        companionEvents: companionEvents.length
      },
      perf,
      ops: snaps.map((s, i) => ({
        index: i,
        type: c.ops[i].type,
        selector: c.ops[i].selector,
        outcome: opOutcomes[i]
      })),
      rollup,
      expected,
      pass
    };
  } finally {
    await ctx.close();
  }
}

async function main() {
  const args = parseArgs();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = resolve(process.cwd(), '..', 'runs', ts);
  mkdirSync(runDir, { recursive: true });

  console.log(`Edge Delivery Hydration Harness`);
  console.log(`Worker: ${args.workerUrl}`);
  console.log(`Origin: ${args.originUrl}`);
  console.log(`Cases:  ${args.selectedCases.map(c => c.id).join(', ')}`);
  console.log(`Variants: ${args.variants.join(', ')}`);
  console.log(`Run dir: ${runDir}`);
  console.log('');

  const browser = await chromium.launch({ headless: !args.headed });
  const records: CaseRunRecord[] = [];

  for (const c of args.selectedCases) {
    for (const v of args.variants) {
      const label = `${c.id} [${v}]`;
      process.stdout.write(`  ${label} ... `);
      try {
        const r = await runOne(browser, args, c, v);
        records.push(r);
        process.stdout.write(`${r.pass ? 'PASS' : 'FAIL'} (got ${r.rollup}, expected ${r.expected})\n`);
      } catch (err) {
        process.stdout.write(`ERROR — ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }
  await browser.close();

  const report: RunReport = {
    startedAt: ts,
    finishedAt: new Date().toISOString(),
    origin: args.originUrl,
    worker: args.workerUrl,
    cases: records,
    summary: {
      total: records.length,
      passes: records.filter(r => r.pass).length,
      failures: records.filter(r => !r.pass).length
    }
  };

  writeJson(resolve(runDir, 'results.json'), report);
  writeFileSync(resolve(runDir, 'report.md'), renderMarkdown(report));
  console.log('');
  console.log(`Wrote ${resolve(runDir, 'report.md')}`);
  console.log(`Summary: ${report.summary.passes}/${report.summary.total} pass`);
  exit(report.summary.failures > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); exit(1); });
