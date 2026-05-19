# Edge Delivery Validation Kit v2 — Playbook (Hydration Lab)

This is the operational runbook for validating Optimizely Edge Delivery against
Vue 3.5 / Nuxt 3 SSR pages. The kit reproduces the customer situation described
in `optimizely_guidance.txt` (Vue and Nuxt SSR + hydration recovery) and ships
a reusable, experiment-agnostic reinforcement mechanism that survives Vue's
hydration recovery without per-experiment code.

> V1 (`../PLAYBOOK.md`) tested for the 304 blank-page bug. V2 tests for what
> happens **after** the bytes arrive — hydration mismatch and recovery. They
> are complementary; the V1 fix (Layer A/B/C) is already in
> `@optimizely/edge-delivery@^1.0.10` upstream.

## Location

All code lives in:

```
edge-del-v2/
  target-app/    Nuxt 3.21 / Vue 3.5 SSR fixture
  edge-worker/   Cloudflare Worker (Optimizely SDK + reinforcement)
  reinforce/     Companion script + shared types
  experiments/   Eight change-type case files
  harness/       Playwright orchestrator
  runs/          Timestamped run outputs
```

## What's in the kit

| Folder        | Purpose                                                                 | When to touch it                                                     |
|---------------|-------------------------------------------------------------------------|----------------------------------------------------------------------|
| `target-app/` | Nuxt SSR target. Five pages exercise every hydration boundary.          | When adding a new target page or component for a new case.           |
| `edge-worker/`| CF Worker — Mode B (local cases) and Mode A (`@optimizely/edge-delivery`).| When changing the dispatch, annotator scope, or companion injection. |
| `reinforce/`  | Companion script (~2 KB). Hooks Nuxt `app:mounted`, re-applies ops.     | When adding a new op type or changing reinforcement semantics.       |
| `experiments/`| 8 JSON case files mapped to guidance buckets.                           | Every new experiment scenario.                                       |
| `harness/`    | Playwright runner. Drives Chromium across each (case × variant) pair.   | When changing assertion logic or report shape.                        |

## Initial setup

```bash
cd edge-del-v2

# 1. Install everything (npm workspaces — all four packages in one pass).
npm install --workspaces --include-workspace-root

# 2. Build the companion bundle (esbuild → ~2KB minified IIFE).
npm run build:reinforce

# 3. Install the Playwright browser (one-time, ~150 MB).
npm run harness:install-browsers
```

## Running the harness locally (no deploy)

The fastest loop — Nuxt dev server, local wrangler, Playwright against
`http://127.0.0.1:8787`.

```bash
# Terminal 1 — Nuxt SSR origin
npm run dev --workspace edge-del-v2-target-app   # serves on :3000

# Terminal 2 — Worker against the local origin (MODE=local)
npm run dev --workspace edge-del-v2-worker       # wrangler dev :8787

# Terminal 3 — Harness
WORKER_URL=http://127.0.0.1:8787 \
ORIGIN_URL=http://127.0.0.1:3000 \
  npm run run:all --workspace edge-del-v2-harness
```

Output lands in `edge-del-v2/runs/<timestamp>/` — `results.json` + `report.md`.

## Running the harness against the deployed lab

Once the Pages site and Worker are deployed (see below):

```bash
WORKER_URL=https://edge-del-v2-worker.<account>.workers.dev \
ORIGIN_URL=https://edge-del-v2-target.pages.dev \
  npm run run:all --workspace edge-del-v2-harness
```

## Deploying the lab

```bash
# 1. Nuxt SSR → Cloudflare Pages
npm run deploy --workspace edge-del-v2-target-app

# Captures the deployed URL — record it for the Worker config.

# 2. Worker — first build the reinforce companion, then deploy.
npm run build:reinforce
npm run deploy --workspace edge-del-v2-worker
```

Update `edge-worker/wrangler.toml` `[env.prod.vars]` `PAGES_ORIGIN` to the
exact Pages URL produced by step 1 before redeploying the Worker.

## Switching from Mode B (local cases) to Mode A (real Optimizely snippet)

Mode A requires an Optimizely Web Experimentation snippet on a test project.
Once you have an accountId + snippetId:

```bash
cd edge-worker
wrangler secret put SNIPPET_ID --env prod    # paste the snippetId
# Optionally edit wrangler.toml [env.prod.vars] MODE = "sdk"
wrangler deploy --env prod
```

Mode A in its current shape calls `applyExperiments()` from the SDK and
injects the companion with a sentinel manifest. To make the reinforcement
layer aware of the SDK's actual per-request changes, build the manifest
parser (see `edge-worker/src/modes/sdk.ts` for the TODO marker). The parser
reads `https://cdn.optimizely.com/public/<accountId>/s/<snippetId>/web_sdk_v0.json`,
extracts the active experiments' changes, and feeds them to the annotator
+ companion just like Mode B does for local cases.

## What the report tells you

`runs/<timestamp>/report.md` has one row per (case × variant). Each row's
**Pass** column compares observed outcome against the case's
`expected.withoutReinforcement` (when variant=reinforce-off) or
`expected.withReinforcement` (when variant=reinforce-on).

A healthy report:

```
| Case                | Bucket   | Variant         | Expected   | Observed   | Vue warnings | Pass |
|---------------------|----------|-----------------|------------|------------|--------------|------|
| 01-text-content     | safe     | reinforce-off   | recovered  | recovered  | 1            | ✓    |
| 01-text-content     | safe     | reinforce-on    | survives   | survives   | 0            | ✓    |
| 04-additive-dom     | fragile  | reinforce-off   | recovered  | recovered  | 1            | ✓    |
| 04-additive-dom     | fragile  | reinforce-on    | survives   | survives   | 0            | ✓    |
| 06-rearrange-keyed  | graceful | reinforce-off   | survives   | survives   | 0            | ✓    |
```

The signal value of the kit is the **off vs on** delta. If reinforce-off
shows `recovered` and reinforce-on shows `survives`, the reinforcement
layer is doing its job. If reinforce-off shows `survives` (case 06), Vue
handled it gracefully — no reinforcement needed for that change type.

## Demo flow for a customer review

1. Open `edge-del-v2-worker.<account>.workers.dev/?case=04-additive-dom&reinforce=off`
   — show the banner missing after hydration. Vue undid it.
2. Open `?case=04-additive-dom&reinforce=on` — banner stays. Companion
   re-applied it after hydration.
3. View page source — `data-allow-mismatch` annotations visible on the
   targeted subtrees, `<script id="edge-del-v2-companion">` near `</body>`.
4. Run the harness and walk through `runs/<latest>/report.md` —
   per-case proof across all eight buckets.

## What's portable to a customer

The reinforcement layer is **drop-in**: the customer adds the
`@edge-del-v2/reinforce` package (or vendors the ~2 KB companion source)
and configures their Edge Delivery worker to:

1. Inject a JSON manifest of the variation's ops (selectors + types).
2. Annotate the affected subtrees with `data-allow-mismatch` of the
   appropriate scope (the annotator function in
   `edge-worker/src/reinforce/annotator.ts` is the reference).
3. Inline the companion script tag.

For Mode B authorship (local JSON cases), the customer uses the same
`experiments/*.json` schema. For Mode A, the customer's existing
Optimizely Edge Delivery setup is unchanged — the annotator + companion
sit on top of `applyExperiments()` and require zero changes to how
experiments are authored in the Optimizely UI.

## Notes

- The `@optimizely/edge-delivery@^1.0.10` package already carries the
  Layer A (status check), Layer B (strip conditional headers), and
  Layer C (null body guard) fixes from the March 2026 AmeriSave
  engagement. Verified by direct inspection of v1.0.11's bundled
  `dist/index.js` (header `delete` calls, `.status!==200` gate,
  `control?.body` guard all present).
- `target-app/components/FeatureGrid.vue` intentionally omits the `:key`
  on its `v-for` so case 05 (rearrange-unkeyed) is exercisable. Do not
  "fix" it — that's the whole point of the case.
- The companion uses `useNuxtApp().hook('app:mounted')` first, falls back
  to a Vue root instance poll, then to `requestIdleCallback`. All three
  arrive at "DOM is post-hydration" — the harness asserts companion
  reapply happens after Vue's reconciliation.

## Prompt for Claude Code (new session)

> I want to run the Edge Delivery hydration validation kit against the
> deployed lab. The kit is in `___temp_research/optimizely-edge-validation-kit/edge-del-v2/`.
> Read `PLAYBOOK-V2.md` for full instructions. Run the harness against
> `https://edge-del-v2-worker.<account>.workers.dev` (origin
> `https://edge-del-v2-target.pages.dev`). Generate the report and tell
> me which cases failed.
