#!/usr/bin/env node
/**
 * Optimizely Edge Validation Kit — Report Generator
 * ══════════════════════════════════════════════════
 * Generates a customer-facing Markdown validation report from JSON run results.
 *
 * Can be used:
 *   1. As a library:  require('./generate-report')(profile, results, timestamp, outputPath)
 *   2. As a CLI:      node generate-report.js <run-directory>
 *
 * REQUIREMENTS: Node.js 18+  (no npm install needed)
 */

'use strict';

const { existsSync, readFileSync, writeFileSync } = require('fs');
const { join, resolve } = require('path');

// ─── REPORT GENERATOR ────────────────────────────────────────────────────────

function generateReport(profile, results, timestamp, outputPath) {
  const lines = [];
  const ln = (s) => lines.push(s === undefined ? '' : s);

  // Parse timestamp for display
  const year  = timestamp.slice(0, 4);
  const month = timestamp.slice(4, 6);
  const day   = timestamp.slice(6, 8);
  const hour  = timestamp.slice(9, 11);
  const min   = timestamp.slice(11, 13);
  const dateFormatted = `${year}-${month}-${day} ${hour}:${min} UTC`;

  // Determine verdicts
  const phase1Pass = results.phase1 ? results.phase1.passed : null;
  const phase2Pass = results.phase2 ? results.phase2.passed : null;
  const overallPass = (phase1Pass !== false) && (phase2Pass !== false);
  const verdict = overallPass ? 'PASS' : 'FAIL';

  // ─── HEADER ─────────────────────────────────────────────────────────────────
  ln('# Optimizely Edge Delivery — Validation Report');
  ln();
  ln('| Field | Value |');
  ln('|-------|-------|');
  ln(`| **Customer** | ${profile.customer} |`);
  ln(`| **Domain** | ${profile.domain} |`);
  ln(`| **Run Date** | ${dateFormatted} |`);
  ln(`| **Run ID** | \`${timestamp}\` |`);
  ln(`| **Overall Verdict** | **${verdict}** |`);
  ln();
  ln('---');
  ln();

  // ─── EXECUTIVE SUMMARY ──────────────────────────────────────────────────────
  ln('## Executive Summary');
  ln();

  if (overallPass) {
    const phasesRun = [];
    if (results.phase1) phasesRun.push('functional testing (Phase 1)');
    if (results.phase2) phasesRun.push('volume/soak testing (Phase 2)');
    ln(`All validation phases completed successfully. ${phasesRun.join(' and ')} detected **zero blank-page occurrences** and **zero network errors**. The edge delivery configuration is operating as expected for the tested URLs.`);
    ln();
    ln('The three safety layers (Status Check, Cache Header Strip, Fail-Open Fallback) are functioning correctly. It is safe to proceed to the next phase of the rollout plan.');
  } else {
    ln('**Issues were detected during validation.** Review the detailed findings below for specific failures and recommended remediation steps. Do not proceed to the next rollout phase until all issues are resolved and a clean validation run is achieved.');
  }
  ln();
  ln('---');
  ln();

  // ─── PHASE 1 ────────────────────────────────────────────────────────────────
  if (results.phase1) {
    const p1 = results.phase1;
    const p1cfg = p1.config || {};

    ln('## Phase 1: Functional Validation (Caching / Blank-Page Test)');
    ln();
    ln('This phase simulates the exact scenario that caused the blank-page incident: a returning visitor whose browser sends caching headers (ETag / If-Modified-Since) back to the server. Each URL is fetched once as a new visitor, then re-fetched multiple times as a returning visitor.');
    ln();

    ln('### Configuration');
    ln();
    ln('| Setting | Value |');
    ln('|---------|-------|');
    ln(`| URLs tested | ${(p1.urls || []).length} |`);
    ln(`| Iterations per URL | ${p1cfg.iters || 'N/A'} |`);
    ln(`| Concurrency | ${p1cfg.concurrency || 'N/A'} |`);
    ln(`| Min HTML bytes | ${p1cfg.minHtmlBytes || 'N/A'} |`);
    if (p1cfg.htmlMarker) ln(`| HTML marker | \`${p1cfg.htmlMarker}\` |`);
    ln();

    ln('### Results by URL');
    ln();

    const urlResults = p1.urls || [];
    for (const u of urlResults) {
      const s = u.summary || {};
      const icon = s.passed ? 'PASS' : 'FAIL';
      ln(`#### ${u.url}`);
      ln();
      ln(`- **Verdict**: **${icon}**`);

      // First visit
      if (u.firstVisit) {
        const fv = u.firstVisit;
        ln(`- First visit: ${fv.ok > 0 ? 'OK' : 'FAILED'} (${fv.errors} errors, ${fv.blankRisks ? fv.blankRisks.length : 0} blank risks)`);
      }

      // Returning visit
      if (u.returningVisit) {
        const rv = u.returningVisit;
        const total = rv.ok + rv.non200 + rv.errors;
        const okRate = total > 0 ? ((rv.ok / total) * 100).toFixed(1) : '0.0';
        ln(`- Returning visitor 200s: **${rv.ok}/${total}** (${okRate}%)`);
        ln(`- Non-200 responses: ${rv.non200}`);
        ln(`- Network errors: ${rv.errors}`);
        ln(`- Blank-page detections: **${rv.blankRisks ? rv.blankRisks.length : 0}**`);
      }

      // Cache tokens
      if (u.cacheTokensFound) {
        const ct = u.cacheTokensFound;
        ln(`- Cache tokens: ETag=${ct.etag ? 'yes' : 'no'}, Last-Modified=${ct.lastModified ? 'yes' : 'no'}`);
      }

      // Response times
      if (s.p50ms !== undefined) {
        ln(`- Response times: p50=${s.p50ms}ms, p95=${s.p95ms}ms`);
      }
      ln();

      // Blank risk details
      if (u.returningVisit && u.returningVisit.blankRisks && u.returningVisit.blankRisks.length > 0) {
        ln('**Blank-page detections:**');
        ln();
        for (const b of u.returningVisit.blankRisks.slice(0, 5)) {
          ln(`- Iteration ${b.iter}: ${b.reason} (${b.bytes} bytes, HTTP ${b.status})`);
        }
        if (u.returningVisit.blankRisks.length > 5) {
          ln(`- ... and ${u.returningVisit.blankRisks.length - 5} more`);
        }
        ln();
      }
    }

    ln('---');
    ln();
  }

  // ─── PHASE 2 ────────────────────────────────────────────────────────────────
  if (results.phase2) {
    const p2 = results.phase2;
    const p2cfg = p2.config || {};
    const icon = p2.passed ? 'PASS' : 'FAIL';

    ln('## Phase 2: Volume / Soak Test');
    ln();
    ln('This phase fires a high volume of requests mixing new-visitor and returning-visitor traffic (1/3 new, 2/3 returning) to confirm consistent delivery under sustained load.');
    ln();

    ln('### Configuration');
    ln();
    ln('| Setting | Value |');
    ln('|---------|-------|');
    ln(`| Total requests | ${(p2cfg.total || 0).toLocaleString()} |`);
    ln(`| Concurrency | ${p2cfg.concurrency || 'N/A'} |`);
    ln(`| Min HTML bytes | ${p2cfg.minHtmlBytes || 'N/A'} |`);
    ln(`| URLs | ${(p2.urls || []).join(', ')} |`);
    ln();

    ln('### Results');
    ln();
    ln(`- **Verdict**: **${icon}**`);
    ln(`- Duration: ${p2.durationSeconds || 'N/A'}s`);
    ln(`- Throughput: ${p2.throughputRps || 'N/A'} req/s`);

    if (p2.counts) {
      ln(`- Blank-page detections: **${p2.counts.blank}**`);
      ln(`- Network errors: **${p2.counts.errors}**`);
    }
    ln();

    // Status code distribution
    if (p2.statusDistribution) {
      ln('### Response Code Distribution');
      ln();
      ln('| Code | Count | Percentage |');
      ln('|------|-------|------------|');
      const total = Object.values(p2.statusDistribution).reduce((a, b) => a + b, 0);
      for (const [code, count] of Object.entries(p2.statusDistribution).sort()) {
        const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
        ln(`| ${code} | ${count.toLocaleString()} | ${pct}% |`);
      }
      ln();
    }

    // Response times
    if (p2.responseTimes) {
      const rt = p2.responseTimes;
      ln('### Response Times');
      ln();
      ln('| Percentile | Time |');
      ln('|------------|------|');
      if (rt.mean !== undefined) ln(`| Mean | ${rt.mean}ms |`);
      if (rt.p50 !== undefined)  ln(`| p50 | ${rt.p50}ms |`);
      if (rt.p90 !== undefined)  ln(`| p90 | ${rt.p90}ms |`);
      if (rt.p95 !== undefined)  ln(`| p95 | ${rt.p95}ms |`);
      if (rt.p99 !== undefined)  ln(`| p99 | ${rt.p99}ms |`);
      ln();
    }

    // x-optly-edge header
    if (p2.optlyHeaderDist && Object.keys(p2.optlyHeaderDist).length > 0) {
      ln('### Edge Worker Header Distribution (`x-optly-edge`)');
      ln();
      ln('| Value | Count | Percentage |');
      ln('|-------|-------|------------|');
      const total = Object.values(p2.optlyHeaderDist).reduce((a, b) => a + b, 0);
      for (const [val, count] of Object.entries(p2.optlyHeaderDist)) {
        const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
        ln(`| ${val} | ${count.toLocaleString()} | ${pct}% |`);
      }
      ln();
    }

    // Blank samples
    if (p2.blankSamples && p2.blankSamples.length > 0) {
      ln('### Blank-Page Samples');
      ln();
      for (const s of p2.blankSamples) {
        ln(`- Request #${s.idx}: ${s.url} — ${s.reason} (${s.bytes} bytes, returning=${s.isReturning})`);
      }
      ln();
    }

    // Error samples
    if (p2.errorSamples && p2.errorSamples.length > 0) {
      ln('### Network Error Samples');
      ln();
      for (const s of p2.errorSamples) {
        ln(`- Request #${s.idx}: ${s.url} — ${s.error}`);
      }
      ln();
    }

    ln('---');
    ln();
  }

  // ─── FINDINGS & RECOMMENDATIONS ────────────────────────────────────────────
  ln('## Findings & Recommendations');
  ln();

  const findings = [];

  // Analyze Phase 1
  if (results.phase1) {
    const p1 = results.phase1;
    if (p1.passed) {
      findings.push({
        severity: 'info',
        title: 'Phase 1 — Functional Validation Passed',
        detail: 'All returning-visitor simulations returned full pages. The caching scenario that caused the original blank-page incident is fully mitigated.',
      });
    } else {
      // Look for specifics
      for (const u of (p1.urls || [])) {
        if (u.summary && !u.summary.passed) {
          if (u.summary.totalBlank > 0) {
            findings.push({
              severity: 'critical',
              title: `Blank pages detected on ${u.url}`,
              detail: `${u.summary.totalBlank} blank-page occurrence(s) during returning-visitor simulation. The edge delivery fix may not be fully applied to this URL.`,
              action: 'Verify Layer A (status check) and Layer B (cache header stripping) are active for this route. Check the edge worker deployment and routing rules.',
            });
          }
          if (u.summary.totalErrors > 0) {
            findings.push({
              severity: 'warning',
              title: `Network errors on ${u.url}`,
              detail: `${u.summary.totalErrors} network error(s) occurred. This may indicate connectivity issues or rate limiting.`,
              action: 'Retry the test. If errors persist, check for rate limiting, WAF rules, or DNS issues.',
            });
          }
        }
        // Check for 304 leaks
        if (u.samples) {
          const leaks304 = u.samples.filter(s => s.type === '304-leak');
          if (leaks304.length > 0) {
            findings.push({
              severity: 'critical',
              title: `304 responses leaking through on ${u.url}`,
              detail: 'The server returned 304 (Not Modified) to the edge worker, meaning conditional headers (If-None-Match / If-Modified-Since) are not being stripped before the origin fetch.',
              action: 'Layer B (cache header stripping) is not active for this route. Verify the edge worker is intercepting requests to this URL and stripping conditional headers.',
            });
          }
        }
      }
    }
  }

  // Analyze Phase 2
  if (results.phase2) {
    const p2 = results.phase2;
    if (p2.passed) {
      const total = p2.config ? p2.config.total : 'N/A';
      findings.push({
        severity: 'info',
        title: 'Phase 2 — Volume / Soak Test Passed',
        detail: `Zero blank pages across ${typeof total === 'number' ? total.toLocaleString() : total} requests under sustained load. Edge delivery is stable.`,
      });
    } else {
      if (p2.counts && p2.counts.blank > 0) {
        findings.push({
          severity: 'critical',
          title: 'Blank pages detected under load',
          detail: `${p2.counts.blank} blank-page occurrence(s) across ${(p2.config ? p2.config.total : 0).toLocaleString()} requests. The fix may have a race condition or capacity issue.`,
          action: 'Review blank-page samples in the soak test output. Check if the edge worker is handling concurrent requests correctly.',
        });
      }
      if (p2.counts && p2.counts.errors > 0) {
        findings.push({
          severity: 'warning',
          title: 'Network errors during soak test',
          detail: `${p2.counts.errors} network error(s). May indicate rate limiting, connection pooling issues, or infrastructure capacity.`,
          action: 'Review error samples. Consider reducing concurrency or investigating rate limiting on the origin.',
        });
      }
    }

    // Response time analysis
    if (p2.responseTimes) {
      const rt = p2.responseTimes;
      if (rt.p95 > 3000) {
        findings.push({
          severity: 'warning',
          title: 'Elevated p95 response times',
          detail: `p95 response time is ${rt.p95}ms (threshold: 3000ms). This may impact user experience.`,
          action: 'Investigate origin server performance or CDN caching configuration.',
        });
      }
    }

    // 304 leak check
    if (p2.statusDistribution && p2.statusDistribution['304'] > 0) {
      findings.push({
        severity: 'critical',
        title: '304 responses in soak test',
        detail: `${p2.statusDistribution['304']} requests returned 304 (Not Modified). Layer B (cache header stripping) may not be active.`,
        action: 'Verify the edge worker is stripping If-None-Match and If-Modified-Since headers before fetching from origin.',
      });
    }
  }

  // Render findings
  if (findings.length === 0) {
    ln('No findings to report.');
  } else {
    for (const f of findings) {
      const icon = f.severity === 'critical' ? '**CRITICAL**' :
                   f.severity === 'warning'  ? '**WARNING**' : 'INFO';
      ln(`### [${icon}] ${f.title}`);
      ln();
      ln(f.detail);
      if (f.action) {
        ln();
        ln(`**Recommended action:** ${f.action}`);
      }
      ln();
    }
  }

  ln('---');
  ln();

  // ─── METHODOLOGY ──────────────────────────────────────────────────────────
  ln('## Methodology');
  ln();
  ln('This validation was performed using the **Optimizely Edge Validation Kit**, which simulates both new and returning visitor traffic patterns. The returning-visitor simulation specifically tests the browser caching scenario (ETag / If-None-Match, Last-Modified / If-Modified-Since) that can trigger blank-page responses when edge delivery is misconfigured.');
  ln();
  ln('### Phase 1 — Functional Validation');
  ln();
  ln('Fetches each URL once as a new visitor to collect cache tokens (ETag, Last-Modified), then re-fetches N times with those tokens to simulate returning visitors. Every response is verified for:');
  ln();
  ln('- HTTP 200 status (not 304)');
  ln('- Minimum body size threshold');
  ln('- Presence of `<html>` and `</body>` tags');
  ln('- Optional: presence of a specific HTML marker');
  ln();
  ln('### Phase 2 — Volume / Soak Test');
  ln();
  ln('Fires M total requests across all URLs with a realistic traffic mix (1/3 new visitors, 2/3 returning visitors). Measures:');
  ln();
  ln('- Blank-page occurrences under sustained load');
  ln('- Network error rate');
  ln('- Response time distribution (p50, p90, p95, p99)');
  ln('- HTTP status code distribution');
  ln('- Edge worker header (`x-optly-edge`) distribution');
  ln();
  ln('### Safety Layers Tested');
  ln();
  ln('| Layer | Protection | How We Test It |');
  ln('|-------|-----------|----------------|');
  ln('| **Layer A** — Status Check | Only apply experiments on 200 OK with full content | Verify all responses are full pages, not blank |');
  ln('| **Layer B** — Cache Header Strip | Remove conditional headers before origin fetch | Send If-None-Match/If-Modified-Since and verify 200 (not 304) |');
  ln('| **Layer C** — Fail-Open Fallback | Return original page on any error | Implicit — any error returns original page |');
  ln();
  ln('---');
  ln();
  ln(`*Generated by Optimizely Edge Validation Kit v1.0*`);
  ln(`*Report ID: ${timestamp}*`);

  // Write output
  const content = lines.join('\n');
  writeFileSync(outputPath, content);
  return content;
}

// ─── CLI MODE ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  const runDir = process.argv[2];

  if (!runDir) {
    console.log('Usage: node generate-report.js <run-directory>');
    console.log('Example: node generate-report.js runs/20260312T143000Z');
    process.exit(1);
  }

  const fullDir = resolve(runDir);

  // Load profile snapshot
  const profilePath = join(fullDir, 'profile-snapshot.json');
  if (!existsSync(profilePath)) {
    console.error(`Profile snapshot not found: ${profilePath}`);
    console.error('Run directory must contain a profile-snapshot.json (created by the orchestrator).');
    process.exit(1);
  }
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));

  // Load results
  const results = { phase1: null, phase2: null };

  const p1Path = join(fullDir, 'phase1-results.json');
  if (existsSync(p1Path)) {
    results.phase1 = JSON.parse(readFileSync(p1Path, 'utf8'));
  }

  const p2Path = join(fullDir, 'phase2-soak.json');
  if (existsSync(p2Path)) {
    results.phase2 = JSON.parse(readFileSync(p2Path, 'utf8'));
  }

  if (!results.phase1 && !results.phase2) {
    console.error('No phase results found in run directory.');
    process.exit(1);
  }

  // Extract timestamp from directory name
  const timestamp = fullDir.split('/').pop() || fullDir.split('\\').pop() || 'unknown';

  const outputPath = join(fullDir, 'report.md');
  generateReport(profile, results, timestamp, outputPath);
  console.log(`Report generated: ${outputPath}`);
}

module.exports = generateReport;
