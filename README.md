# Optimizely Edge Delivery — Validation Kit

A reusable validation harness for proving Optimizely Edge Delivery deployments are healthy on any target domain. Probes the specific blank-page scenario caused by browser conditional requests (304 responses) and validates the three safety layers a fix should provide: Status Check (Layer A), Cache Header Strip (Layer B), and Fail-Open Fallback (Layer C).

Pure Node.js 18+. No `npm install` required — uses built-in `fetch`.

See [`PLAYBOOK.md`](./PLAYBOOK.md) for the operational runbook, [`edge-delivery-sdk-analysis/`](./edge-delivery-sdk-analysis/) for the SDK root-cause write-up, and [`ENGINEERING-REPORT-FASTLY-FEASIBILITY.md`](./ENGINEERING-REPORT-FASTLY-FEASIBILITY.md) for the Fastly Compute port assessment.

---

## Requirements

- Node.js 18 or higher (no npm install needed — uses built-in `fetch`)
- Network access to the target domain

Check your version:
```bash
node --version
```

---

## Quick Start

### 1. Probe the target URL (calibrate settings)
```bash
node probe.js https://www.example.com/landing
```
This inspects the URL and recommends `MIN_HTML_BYTES` and `HTML_MARKER` values. Update the customer profile with these settings before running validation.

### 2. Create or edit a customer profile
```bash
# Profiles live in profiles/
cat profiles/example.json
```

### 3. Dry run (see what would execute, no actual requests)
```bash
node run-validation.js --profile profiles/example.json --dry-run
```

### 4. Run the full validation
```bash
node run-validation.js --profile profiles/example.json
```

### 5. Review results
Each run creates a timestamped directory under `<outputDir>/runs/<timestamp>/` (defaults to `runs/`) containing:
- `profile-snapshot.json` — exact config used
- `phase1-results.json` — functional test results
- `phase2-soak.json` — soak test results
- `report.md` — customer-facing Markdown report

---

## Directory Structure

```
optimizely-edge-delivery-validation/
├── run-validation.js         # Main orchestrator — use this
├── probe.js                  # URL inspector for calibration
├── validate-edge.js          # Phase 1: functional caching test (standalone)
├── soak-test.js              # Phase 2: volume soak test (standalone)
├── test-fix.js               # Side-by-side fix verification (no deploy needed)
├── generate-report.js        # Markdown report generator (standalone + library)
├── README.md                 # This file
├── PLAYBOOK.md               # Operational runbook
├── ENGINEERING-REPORT-FASTLY-FEASIBILITY.md
├── edge-delivery-sdk-analysis/   # SDK 304 blank-page root cause + reference patch
└── profiles/
    └── example.json          # Template profile — copy and adapt per target
```

After your first run, an output directory appears (named by `outputDir` in the profile, defaults to `runs/`):

```
runs/
├── runs-index.json           # Run history tracker
└── 20260312T143052Z/         # Timestamped run
    ├── profile-snapshot.json
    ├── phase1-results.json
    ├── phase2-soak.json
    └── report.md
```

---

## Scripts Reference

### `run-validation.js` — The Orchestrator (Primary Entry Point)

Reads a customer profile, executes the configured phases, generates the customer report, and tracks run history.

```bash
# Full validation (Phase 1 + Phase 2)
node run-validation.js --profile profiles/example.json

# Phase 1 only (functional caching test)
node run-validation.js --profile profiles/example.json --phase 1

# Phase 2 only (volume soak test)
node run-validation.js --profile profiles/example.json --phase 2

# Dry run — show what would execute
node run-validation.js --profile profiles/example.json --dry-run

# Skip report generation
node run-validation.js --profile profiles/example.json --skip-report
```

**Exit codes:** `0` = all phases passed, `1` = any failure detected.

---

### `probe.js` — URL Inspector

Quick-fetches a URL and reports everything needed to calibrate the validation scripts.

```bash
node probe.js https://www.example.com/landing
```

**Reports:**
- HTTP status, content-type, body size, response time
- Cache headers (ETag, Last-Modified, Cache-Control)
- Edge/CDN headers (x-optly-edge, cf-ray, x-cache)
- HTML structure analysis
- Return-visit simulation (sends conditional headers)
- Recommended `MIN_HTML_BYTES` and `HTML_MARKER` settings

---

### `validate-edge.js` — Phase 1: Functional Caching Test

Simulates a returning visitor hitting your site. Fetches each page twice — once as a new visitor, once sending the browser's caching signals back. Checks every response is a full page, never blank.

```bash
# Standalone usage (without orchestrator)
node validate-edge.js https://www.yoursite.com/ https://www.yoursite.com/pricing

# With options
ITERS=500 HTML_MARKER='id="main-content"' OUTPUT_FILE=results.json \
  node validate-edge.js https://www.yoursite.com/

# With debug header check
OPTLY_DEBUG=1 node validate-edge.js https://www.yoursite.com/
```

**Options (environment variables):**
| Variable | Default | Description |
|----------|---------|-------------|
| `ITERS` | 200 | Returning-visitor cycles per URL |
| `MIN_HTML_BYTES` | 5000 | Minimum bytes to consider a page "full" |
| `HTML_MARKER` | (none) | HTML string that must appear in every response |
| `OPTLY_DEBUG` | off | Set to `1` to check for `x-optly-edge` response header |
| `CONCURRENCY` | 5 | Parallel requests |
| `OUTPUT_FILE` | edge-validation-report.json | Where to save JSON results |

**Pass condition:** `blankRisk = 0`, `errors = 0`

---

### `soak-test.js` — Phase 2: Volume / Stress Test

Fires 10,000 requests mixing new-visitor and returning-visitor traffic (2/3 returning, 1/3 new). Records blank-page counts, error counts, and response time percentiles.

```bash
# Standalone usage (without orchestrator)
node soak-test.js https://www.yoursite.com/ https://www.yoursite.com/pricing

# With options
TOTAL=10000 CONCURRENCY=30 HTML_MARKER='id="app"' OUTPUT_FILE=soak.json \
  node soak-test.js https://www.yoursite.com/

# Lighter run for a quick check
TOTAL=1000 CONCURRENCY=10 node soak-test.js https://www.yoursite.com/
```

**Options (environment variables):**
| Variable | Default | Description |
|----------|---------|-------------|
| `TOTAL` | 10000 | Total requests to send |
| `CONCURRENCY` | 20 | Parallel workers |
| `MIN_HTML_BYTES` | 5000 | Minimum bytes to consider a page "full" |
| `HTML_MARKER` | (none) | HTML string that must appear |
| `OUTPUT_FILE` | soak-report.json | Where to save JSON results |

**Pass condition:** `blank = 0`, `errors = 0`

---

### `generate-report.js` — Report Generator

Generates a customer-facing Markdown report from run results. Called automatically by the orchestrator, but can also be run standalone to regenerate a report.

```bash
# Regenerate report for an existing run
node generate-report.js runs/20260312T143052Z
```

---

## Customer Profiles

Profiles are JSON files in `profiles/` that configure per-customer validation settings.

```json
{
  "customer": "Example",
  "domain": "www.example.com",
  "outputDir": "runs",
  "urls": [
    "https://www.example.com/landing"
  ],
  "phase1": {
    "iterations": 200,
    "concurrency": 5,
    "minHtmlBytes": 500,
    "htmlMarker": "",
    "optlyDebug": false
  },
  "phase2": {
    "total": 10000,
    "concurrency": 20,
    "minHtmlBytes": 500,
    "htmlMarker": ""
  },
  "notes": "Optional notes about this customer's setup."
}
```

### Creating a new customer profile

1. Copy the template profile: `cp profiles/example.json profiles/my-target.json`
2. Run the probe to calibrate: `node probe.js https://my-target.example.com/`
3. Update `urls`, `minHtmlBytes`, and `htmlMarker` based on probe output
4. Set `outputDir` (defaults to `runs`)
5. Run validation: `node run-validation.js --profile profiles/my-target.json`

---

## What to Look For in Results

| Field | Good | Investigate if... |
|---|---|---|
| Blank-page detections | 0 | > 0 |
| Network errors | 0 | > 0 |
| Status 200 rate | ~100% of HTML pages | < 95% |
| Status 304 in results | 0 (fix is working) | > 0 (conditional headers may not be stripped) |
| p95 response time | < 2000ms | > 3000ms |
| x-optly-edge: applied | > 0% of requests | 0% (check deploy) |
| x-optly-edge: error | 0 | > 0 (check worker logs) |

---

## Recommended Workflow

### Phase 1 — Functional validation
```bash
node run-validation.js --profile profiles/example.json --phase 1
```

### Phase 2 — Volume validation
```bash
node run-validation.js --profile profiles/example.json --phase 2
```

### Phase 3 — Internal preview with debug header
Set `optlyDebug: true` in the profile's `phase1` config, then:
```bash
node run-validation.js --profile profiles/example.json --phase 1
```
Also browse manually with a cookie `optly_preview=1` and check the Network tab for `x-optly-edge`.

### Phase 4 — Canary rollout monitoring
Re-run at intervals during traffic ramp-up:
```bash
node run-validation.js --profile profiles/example.json
```
Each run is tracked in `runs-index.json` for trend comparison.

---

## Exit Codes

All scripts exit `0` on pass, `1` on any failure.

```bash
# Chain phases with error checking
node run-validation.js --profile profiles/example.json --phase 1 && \
  echo "Phase 1 passed, running soak..." && \
  node run-validation.js --profile profiles/example.json --phase 2
```

---

## Understanding the x-optly-edge Debug Header

If the edge worker is deployed with debug support, requests with the `X-Optly-Debug: 1` header will get a response header indicating what happened:

| Value | Meaning |
|---|---|
| `edge: applied` | Experiment was applied successfully |
| `edge: bypassed (status!=200)` | Worker detected non-200 and safely returned original page |
| `edge: bypassed (non-html)` | Non-HTML content, worker correctly skipped |
| `edge: error (fell back to origin)` | Error occurred, Layer C returned original page safely |

---

## License

[MIT](./LICENSE)
