# Edge Delivery Validation Kit — Playbook

This is the playbook for running the Optimizely Edge Delivery validation kit against any customer domain. Give this document to Claude Code and it will know what to do.

## Location

All scripts live in:
```
___temp_research/optimizely-edge-validation-kit/
```

No `npm install` needed. Scripts are plain Node.js (v18+), zero dependencies.

## What's in the kit

| Script | What it does | When to use it |
|--------|-------------|----------------|
| `probe.js` | Single request to inspect a URL. Shows page size, framework, caching headers, 304 behavior. Recommends settings for the profile. | First. Always start here for a new customer. |
| `validate-edge.js` | Phase 1 — Simulates returning visitors. Sends conditional headers (If-Modified-Since, If-None-Match) to check for 304 blank-page risk. | After probe. This is the core test. |
| `soak-test.js` | Phase 2 — Volume test. Fires many requests with a mix of new/returning visitors under sustained load. | After Phase 1 passes. Full confidence test. |
| `test-fix.js` | Side-by-side comparison. Group A sends conditional headers (current behavior), Group B strips them (fixed behavior). Proves the fix works. | When the SDK does NOT have the fix yet and you need proof. |
| `run-validation.js` | Orchestrator. Reads a profile, runs Phase 1 + Phase 2, generates a report, saves everything in a timestamped run folder. | For formal customer-facing runs. |
| `generate-report.js` | Generates a markdown report from run results. | Called by the orchestrator automatically, or standalone. |
| `profiles/` | JSON config files per customer. One file per customer. | Every run needs a profile. |

## Step-by-step: New customer

### Step 1 — Probe the URL

Run the probe to understand the page:

```bash
cd ___temp_research/optimizely-edge-validation-kit
node probe.js https://customer-domain.com/page-to-test
```

This tells you:
- Page size (you need this for `minHtmlBytes` — set it to about 50% of the page size)
- Framework (look for markers like `id="__nuxt"`, `id="app"`, `id="root"`, `id="__next"`)
- Whether `Last-Modified` or `ETag` is present (needed for 304 testing)
- Whether `x-optly-edge` or Optimizely cookies are present (tells you if the SDK is active)
- Whether a return visit gets a 304 (this is the vulnerability)

### Step 2 — Create a customer profile

Create a JSON file in `profiles/`. Copy an existing one and adjust:

```json
{
  "customer": "Customer Name",
  "domain": "www.customer.com",
  "outputDir": "customer-name",
  "urls": [
    "https://www.customer.com/page-one",
    "https://www.customer.com/page-two"
  ],
  "phase1": {
    "iterations": 200,
    "concurrency": 5,
    "maxRps": 10,
    "minHtmlBytes": 50000,
    "htmlMarker": "id=\"app\"",
    "optlyDebug": false
  },
  "phase2": {
    "total": 1000,
    "concurrency": 20,
    "maxRps": 25,
    "minHtmlBytes": 50000,
    "htmlMarker": "id=\"app\""
  },
  "notes": "Brief notes about the customer page, what you found in the probe."
}
```

Field guide:
- `minHtmlBytes` — Set to ~50% of the page size from the probe. If page is 220KB, set to 80000-100000.
- `htmlMarker` — A string that must appear in the page body to consider it valid. Use what the probe suggests (e.g., `id="__nuxt"` for Nuxt, `id="root"` for React, `id="app"` for Vue).
- `maxRps` — Requests per second limit. Be a good citizen. 10 rps for Phase 1, 25 rps for Phase 2 is safe for most sites. Talk to the customer's security team first if going higher.
- `iterations` — Number of returning-visitor simulations in Phase 1. 200 is a good default for a sniff test. 1000+ for a formal run.
- `total` — Total requests in Phase 2 soak test. 1000 for initial runs, 10000 for formal evidence.

### Step 3 — Run Phase 1 (returning-visitor test)

Quick run directly:

```bash
ITERS=200 CONCURRENCY=5 MAX_RPS=10 MIN_HTML_BYTES=80000 HTML_MARKER='id="__nuxt"' \
  node validate-edge.js https://www.customer.com/page
```

Or use the orchestrator with a profile:

```bash
node run-validation.js --profile profiles/customer-name.json --phase 1
```

What to look for:
- **Returning-visitor 200s: 200/200** — The fix is working. All returning visitors get full pages.
- **Non-200 responses (304s)** — The fix is NOT active or not deployed. The 304s are the blank-page risk.
- **Blank-page detections** — Should always be 0. If not, something is seriously wrong.

### Step 4 — Run Phase 2 (soak test)

```bash
node run-validation.js --profile profiles/customer-name.json --phase 2
```

Or directly:

```bash
TOTAL=1000 CONCURRENCY=20 MAX_RPS=25 MIN_HTML_BYTES=80000 HTML_MARKER='id="__nuxt"' \
  node soak-test.js https://www.customer.com/page
```

What to look for:
- **Zero blank pages** across all requests
- **Zero errors**
- **Status distribution** — should be 100% HTTP 200 if the fix is active. If you see 304s, the fix is not deployed.
- **Response times** — p95 under 200ms is good. Higher means the worker might be doing heavy processing or the origin is slow.

### Step 5 — Generate the report

If you used the orchestrator, the report is generated automatically in `{outputDir}/runs/{timestamp}/report.md`.

If you ran scripts manually, use:

```bash
node run-validation.js --profile profiles/customer-name.json
```

This runs both phases and generates everything.

## Quick reference: Run validation for an existing customer

Already have a profile? One command:

```bash
node run-validation.js --profile profiles/example.json
```

This creates a timestamped run folder with all results and a report.

## How to validate the SDK fix without deploying it

Use `test-fix.js`. This runs a side-by-side comparison without requiring any deployment:

```bash
ITERS=100 CONCURRENCY=5 MAX_RPS=10 \
  node test-fix.js https://www.customer.com/page
```

- **Group A** sends conditional headers (simulates current/broken behavior)
- **Group B** strips conditional headers (simulates the Layer B fix)

If Group A gets 304s and Group B gets all 200s, the fix works. This proves it without touching the customer's infrastructure.

## Checking if the edge worker is active

The SDK does not set an `x-optly-edge` header. The indicators that the worker is active are Optimizely cookies in the response:

```bash
curl -s -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36" \
  -H "Accept: text/html" \
  -D - -o /dev/null https://customer-domain.com/page
```

Look for:
- `set-cookie: optimizelyEndUserId=...` — Worker is active
- `set-cookie: OPTY$$...VMAP=...` — Variation map is being set
- `set-cookie: optimizelySession=...` — Session tracking active

If none of these appear, the worker is not processing the request.

## Important notes

- **Always use a browser User-Agent.** Some customers have bot protection (Cloudflare WAF, etc.) that blocks requests without a real User-Agent. All scripts are already configured with a Chrome User-Agent.
- **Rate limit everything.** Always set `maxRps` in the profile. Be a good citizen. Talk to the customer's security team before running tests.
- **Test clean URLs first.** Some customer applications append session parameters to URLs. Test the base URL without parameters first to isolate edge worker behavior from application routing.
- **Results go in `{outputDir}/runs/{timestamp}/`.** Each run gets its own timestamped folder with a profile snapshot, phase results, and a markdown report.
- **The `package.json` matters.** It sets `"type": "commonjs"` which is needed because the scripts use `require()`. Don't delete it.

## Example profile

| Profile | Notes |
|---------|-------|
| `profiles/example.json` | Template profile — copy and adapt per target |

## File structure after runs

```
optimizely-edge-validation-kit/
  profiles/
    example.json                <- template — copy per target
    <your-target>.json
  <outputDir from profile>/
    runs/
      20260313T040625Z/         <- timestamped run
        profile-snapshot.json
        phase1-results.json
        phase2-soak.json
        report.md               <- run report
  edge-delivery-sdk-analysis/
    index.ts.original           <- original SDK source
    index.ts.patched            <- patched SDK with 3-layer fix
    fix.patch                   <- unified diff
    ROOT-CAUSE-AND-FIX.md       <- technical root cause
  probe.js
  validate-edge.js
  soak-test.js
  test-fix.js
  run-validation.js
  generate-report.js
  PLAYBOOK.md                   <- this file
```

## Prompt for Claude Code

If you want to hand this to Claude Code in a new session, paste this:

---

I need you to run an Edge Delivery validation test for a customer. The validation kit is in `___temp_research/optimizely-edge-validation-kit/`. Read the `PLAYBOOK.md` file in that folder for the full instructions.

Customer: [customer name]
Domain: [customer domain]
URLs to test: [URLs]
Phase: [1, 2, or both]
Notes: [anything special — bot protection, rate limit concerns, session params, etc.]

---

That's it. Claude Code will read the playbook, probe the URL, create/update the profile, and run the tests.
