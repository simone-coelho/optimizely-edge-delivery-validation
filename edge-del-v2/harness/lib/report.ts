// Markdown report generator. Mirrors the V1 report shape so customer
// reviewers see a familiar layout, with hydration-specific columns added.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface CaseRunRecord {
  caseId: string;
  caseName: string;
  bucket: string;
  page: string;
  variant: 'reinforce-off' | 'reinforce-on';
  url: string;
  workerHeader: string | null;
  hydration: {
    vueWarnings: number;
    sampleWarnings: string[];
    companionEvents: number;
  };
  perf: {
    fcp?: number;
    lcp?: number;
    domContentLoaded?: number;
    load?: number;
  };
  ops: Array<{
    index: number;
    type: string;
    selector: string;
    outcome: 'survives' | 'recovered' | 'partial' | 'not-applied';
  }>;
  rollup: 'survives' | 'recovered' | 'partial' | 'not-applied';
  expected: 'survives' | 'recovered' | 'partial';
  pass: boolean;
}

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  origin: string;
  worker: string;
  cases: CaseRunRecord[];
  summary: {
    total: number;
    passes: number;
    failures: number;
  };
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export function renderMarkdown(report: RunReport): string {
  const lines: string[] = [];
  lines.push(`# Edge Delivery Hydration Validation — Run Report`);
  lines.push('');
  lines.push(`- Started: \`${report.startedAt}\``);
  lines.push(`- Finished: \`${report.finishedAt}\``);
  lines.push(`- Worker: \`${report.worker}\``);
  lines.push(`- Origin: \`${report.origin}\``);
  lines.push(`- Summary: **${report.summary.passes} / ${report.summary.total} pass** (${report.summary.failures} failures)`);
  lines.push('');
  lines.push(`## Per-case results`);
  lines.push('');
  lines.push(`| Case | Bucket | Variant | Expected | Observed | Vue warnings | FCP (ms) | Pass |`);
  lines.push(`|------|--------|---------|----------|----------|--------------|----------|------|`);
  for (const c of report.cases) {
    lines.push([
      `\`${c.caseId}\``,
      c.bucket,
      c.variant,
      c.expected,
      c.rollup,
      String(c.hydration.vueWarnings),
      c.perf.fcp ? c.perf.fcp.toFixed(0) : '—',
      c.pass ? '✓' : '✗'
    ].join(' | '));
  }
  lines.push('');
  lines.push(`## Details`);
  for (const c of report.cases) {
    lines.push('');
    lines.push(`### ${c.caseId} — ${c.caseName} [${c.variant}]`);
    lines.push('');
    lines.push(`- Page: \`${c.page}\`  |  URL: \`${c.url}\``);
    lines.push(`- Worker header: \`${c.workerHeader || '(absent)'}\``);
    lines.push(`- Rollup outcome: **${c.rollup}** (expected **${c.expected}**) — ${c.pass ? 'PASS' : 'FAIL'}`);
    lines.push(`- Vue hydration warnings: ${c.hydration.vueWarnings}; companion events: ${c.hydration.companionEvents}`);
    if (c.hydration.sampleWarnings.length) {
      lines.push('  - Samples:');
      for (const s of c.hydration.sampleWarnings.slice(0, 3)) {
        lines.push('    - `' + s.slice(0, 200).replace(/`/g, '`') + '`');
      }
    }
    lines.push('');
    lines.push(`| Op # | Type | Selector | Outcome |`);
    lines.push(`|------|------|----------|---------|`);
    for (const op of c.ops) {
      lines.push(`| ${op.index} | ${op.type} | \`${op.selector}\` | ${op.outcome} |`);
    }
  }
  return lines.join('\n') + '\n';
}
