# AGENTS.md — Optimizely Edge Delivery Hydration Reinforcement

> AI agent reference. Read this once. After reading, you can answer
> any question about what this is, where the code lives, what runs
> on the edge, what runs in the browser, and how the two halves
> connect. Human-targeted documentation lives in `training-pack/`.

## What this is, in one paragraph

A two-part fix for the problem that Optimizely Edge Delivery variations
applied via Cloudflare worker are silently undone by SSR frameworks
(Vue 3 / Nuxt 3, React 18 / Next.js) during hydration and again during
client-side SPA navigation. Part 1: an **edge worker post-processor**
that runs after `applyExperiments()` and injects a small inline
`<script>` (the *companion*) plus a JSON manifest describing what the
SDK applied. Part 2: the **companion** runs in the browser, reads the
manifest, waits for the framework's "mount complete" signal, and
idempotently re-applies any variation ops the framework's hydration
recovery undid. The companion also hooks the History API so the same
re-apply happens on every SPA navigation.

No npm package exists. The code lives in this repository.

---

## The two pieces

```
EDGE WORKER (Cloudflare)                BROWSER (after HTML arrives)
─────────────────────────              ─────────────────────────────
1. SSR handler → Response               A. Parse HTML → first paint
                                            shows the variation.
2. applyExperiments(...)
   = Optimizely SDK rewrites           B. Companion <script> executes
   body via HTMLRewriter,                  immediately (it's at the
   stamps data-optly-<id>=""               bottom of <body>):
   on every modified element                 - reads inline manifest
                                              - hooks History API
3. POST-PROCESS (new):                        - waits for hydration
   - scan body for                            - emits boot:armed
     data-optly-<id> markers
   - fetch project manifest            C. Framework hydrates. May
     from cdn.optimizely.com               discard variation nodes
     (cache hit, ~1ms)                     during reconciliation.
   - build Op[]                            Variation may disappear.
   - inject 2 <script> tags
     before </body>:                   D. Hydration completes →
     • application/json manifest          framework fires its mount
     • the companion IIFE                  signal (app:mounted /
                                           useEffect / onMount /
4. Return Response                         requestIdleCallback).
                                          Companion replays ops.
                                          Variation is back.

                                       E. SPA navigation: pushState/
                                          replaceState/popstate
                                          fire → companion replays
                                          ops. Variation stays.
```

---

## Where the code is

| Concern | Path |
|---|---|
| Edge worker post-processor (reference impl, with Nuxt scaffolding) | `target-app/server/edge-entry.ts` |
| Edge worker post-processor (drop-in, no scaffolding) | `reinforcement-layer/training-pack/code/worker-integration.ts` |
| Browser companion (source) | `reinforce/src/companion.ts` |
| Companion DOM primitives | `reinforce/src/ops.ts` |
| Shared types | `reinforce/src/types.ts` |
| Companion build script | `reinforce/build.mjs` |
| Drop-in copy for customer engagements | `reinforcement-layer/training-pack/code/` |
| Diagrammatic walkthrough (human-facing) | `reinforcement-layer/training-pack/0-how-it-works.md` |
| Deep reference (1,300 lines) | `reinforcement-layer/CUSTOMER-GUIDE.md` |

---

## The data contract — one JSON tag

The edge and browser sides agree on this and nothing else:

```html
<script type="application/json" id="optly-companion-manifest">
{
  "appliedAt": "edge",
  "ops": [
    { "type":"attribute", "selector":".x", "name":"class", "value":"" },
    { "type":"add",       "selector":"main", "position":"prepend", "html":"<div>…</div>" },
    { "type":"move",      "selector":"header", "toSelector":".x", "position":"before" }
  ]
}
</script>
```

Op vocabulary (six types, exhaustive):

| `type` | Fields | Effect |
|---|---|---|
| `text` | `selector, value` | replace textContent |
| `attribute` | `selector, name, value` | set one attribute |
| `class` | `selector, add?, remove?` | class delta |
| `add` | `selector, html, position` | insert HTML at position relative to selector |
| `remove` | `selector` | remove element |
| `move` | `selector, toSelector, position` | move source to target |

`position` is one of `before | after | prepend | append | replace`.

---

## Deployment — what gets added where

**Edge worker side.** Wrap the existing `applyExperiments()` call with
the post-processor. Reference:
`reinforcement-layer/training-pack/code/worker-integration.ts`. Three
new things in the response: regex scan, manifest fetch, JSON+script
injection. ~30 lines around existing code.

**Browser side.** Nothing to install in user-land. The companion ships
inline in the HTML response. Framework code is unchanged. Component
code is unchanged. The customer's repo is read-only from the
experiment's perspective.

CSP exception: if the customer's CSP forbids inline scripts, the
companion is hosted as a same-origin static asset and pulled in via
`<script src>` instead. See `training-pack/2-engineering-handbook.md`
§ Part 2.

---

## Routing & cost — the worker must only run on HTML

The worker MUST NOT run on every request. Assets, JSON APIs, fonts,
images, third-party callbacks should bypass it entirely. Three-layer
model, all three required for production:

1. **`_routes.json`** (Cloudflare Pages) or **`wrangler.toml` routes**
   (standalone Worker). Excludes asset directories so requests never
   invoke the worker. **Free at runtime.**
2. **`shouldProcess()` early return** at the top of the worker `fetch`
   handler. Catches anything that slips past Layer 1 — file
   extensions outside asset directories, non-GET verbs, Accept
   headers that don't include `text/html`. **~few hundred microseconds
   on bypass.**
3. **Content-type check** on the SSR response (already in
   `worker-integration.ts`). Catches the case where the request
   looked like HTML but the origin returned JSON / a redirect / an
   error page.

Helper: `reinforcement-layer/training-pack/code/should-process.ts`.
Full guide with sample `_routes.json` and verification checklist:
`reinforcement-layer/training-pack/4-deployment-routing.md`.

The wrong default is "the worker runs on everything." The right
default is "the worker runs only where it can deliver value."

---

## Verification — what to check after install

| Where | What | Healthy value |
|---|---|---|
| DevTools → Network → document → Response Headers | `x-optly-reinforce` | `on` |
| View Source → search `optly-companion-manifest` | JSON manifest with `ops` array | Non-empty array |
| DevTools → Console → `__EDGE_DEL_V2__` | Object with `manifest`, `ranAt`, `events` | events include `boot:armed`, `route:history-patched`, `<framework>:hook-armed`, `initial:applied` |
| Inspect a variation-modified element | `data-edge-applied="…"` attribute | Present (companion's idempotency mark) |
| SPA-navigate away and back, re-inspect | Variation present | Yes |

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Manifest tag present, `ops: []` | VMAP cookie empty — visitor not bucketed | Audience/URL targeting miss. Not a code defect. |
| `__EDGE_DEL_V2__` undefined | CSP blocked inline `<script>` | Use nonce or static-asset variant. |
| Variation present cold, gone after SPA navigation | History API hooks didn't install | Check console for `route:history-patched` event. Confirm router uses `history.pushState`. |
| Variation gone immediately on first paint | Edge worker didn't apply variation | Check `x-optly-reinforce` header. Confirm experiment's `activation_type` is `immediate`, not `dom_changed`. |
| `[Vue warn] Hydration mismatch` in dev builds | Expected | Companion exists precisely to recover from this. Warning is informational. |
| Variation appears, flickers, disappears, reappears | Hydration window between SSR and companion replay | Single-frame flicker is expected. To suppress: add `data-allow-mismatch="children"` (Vue 3.5+) on the *exact* element whose children the variation modifies. |

---

## The `activation_type` gotcha (most common silent failure)

Every Optimizely Page object has an `activation_type` field:

| Value | Edge worker behavior |
|---|---|
| `immediate` | SDK applies it. Variation is in SSR. |
| `dom_changed` | **SDK skips it entirely.** Variation never reaches the edge. |

The Visual Editor sets `activation_type` to `dom_changed` automatically
if the experiment has an `element_present` URL condition. The Visual
Editor adds `element_present` automatically when the experiment uses
`rearrange`. Net effect: authoring a rearrange in the Visual Editor
can silently flip the whole experiment to client-side-only.

If the reinforcement layer is installed and an experiment still
doesn't show at the edge, this is the first thing to audit:

```
GET /v2/pages/<pageId> → check .activation_type
```

If `dom_changed`: `PATCH /v2/pages/<pageId>` with
`{ "activation_type": "immediate", "conditions": [...without element_present...] }`,
then pause + restart the experiment to flush the CDN manifest.

Documented in detail: `CUSTOMER-GUIDE.md` § 9.1.

---

## What changes vs the snippet-only setup

| | Snippet only (vanilla) | Snippet + companion (`snippet-pack/`) | Edge + companion (`training-pack/`) |
|---|---|---|---|
| Variation in HTML response? | No | No | Yes |
| Visible at first paint? | No (flicker) | No (flicker) | Yes |
| Visible to SEO crawlers? | No | No | Yes |
| Survives hydration on Vue/React? | n/a | Yes (companion replays from snippet data) | Yes (companion replays from inline manifest + snippet data) |
| Survives SPA navigation? | Partial (DSW) | Yes (companion replays per route) | Yes |
| Survives in-place region re-render (Backbone view swap, mini-cart, facet filter)? | Partial (DSW) | Yes (companion's `observeRerenders`) | Yes |
| Extra HTTP request? | 1 (snippet) | 1 (snippet) | 0 (companion inlined) |
| Per-experiment client code? | sometimes | never | never |
| Bundle cost | ~10 KB (snippet) | ~10 KB snippet + ~10 KB companion | ~10 KB snippet + ~2 KB gzipped inline companion |

## Snippet-only deployments — the `snippet-pack/`

For customers who are NOT on Edge Delivery (vanilla Optimizely Web
Experimentation, snippet pasted in `<head>`), the companion still
applies — it auto-selects an adapter based on the page's framework
and replays variations on every SPA navigation and in-place region
re-render. There is no edge manifest; the companion extracts ops
directly from `window.optimizely.get('data')` at runtime.

The primary documented deployment is **SuiteCommerce Advanced**
(Backbone.js), used by Mystery Ranch and other NetSuite storefronts.

- Customer-facing guide: `reinforcement-layer/snippet-pack/README.md`
- SuiteCommerce config + revenue helper: `reinforcement-layer/snippet-pack/code/`
- Same engine: `reinforcement-layer/training-pack/code/companion.ts`
  (with `framework: 'backbone'` config). The companion's adapter layer
  was designed to serve both deployment paths from a single source.

---

## FAQ — questions an agent may be asked

**Q: Where do I deploy the worker code?**
A: `reinforcement-layer/training-pack/code/worker-integration.ts`. Vendor that file into the customer's worker source tree.
Build companion artifacts with `node reinforcement-layer/training-pack/code/build-companion.mjs`.
Wire by calling `handleRequestWithReinforcement(request, env, ctx, ssrFetch)` from the existing `fetch` handler.

**Q: What do I install on the client?**
A: Nothing. The companion ships inline in the SSR response. Component
code, framework code, and customer build configuration are all
unchanged.

**Q: Does this need a separate Optimizely snippet?**
A: No. It uses the same Optimizely Edge Delivery SDK call
(`applyExperiments`) the customer already makes. The post-processor
runs after.

**Q: Does this change my experiments?**
A: No. The Optimizely project, audiences, URL targeting, and variation
authoring are unchanged. Existing experiments work; new experiments
work; the difference is they survive hydration.

**Q: What about Custom Code variations?**
A: Custom Code can't be safely replayed from a manifest (arbitrary JS
with side effects). The Optimizely SDK already ships Custom Code as a
separate `<script>` tag in the SSR response; that script is responsible
for being defensive about re-running (e.g. MutationObserver pattern).
The companion intentionally skips `custom_code` change types.

**Q: How big is the companion?**
A: ~8 KB raw, under 2 KB gzipped. Inlined into the SSR response — no
extra HTTP request, no DNS lookup, no TLS handshake.

**Q: Performance cost on the edge worker?**
A: One body read (already in memory), one regex scan, one
`cdn.optimizely.com` fetch (cache hit ~1ms), one JSON.stringify, one
body splice. Sub-millisecond on warm cache. Cold-edge first-request
adds 50-200ms for the manifest fetch.

**Q: Does this work on React / Next.js?**
A: The companion is framework-agnostic at the DOM-manipulation level.
Framework-specific hooks (the "wait for mount" signal) ship as
adapters in `reinforce/src/companion.ts`. Vue 3.5/Nuxt 3 is the
reference adapter; React 18/Next.js adapter is documented (not yet
shipped). The generic `requestIdleCallback` fallback works on any
framework.

**Q: What if there's no variation on a page?**
A: The manifest tag is still injected but with an empty `ops` array.
The companion sees empty ops, emits `boot:armed` and `initial:applied`,
and does nothing. Zero-cost on pages without variations.

**Q: Where is the live lab?**
A: <https://edge-del-v2-target.pages.dev/>. Three modes via query
parameters:
- `/hire/cs/pricing?variation=off` — control
- `/hire/cs/pricing?reinforce=off` — variation, no companion
- `/hire/cs/pricing` — variation + companion

**Q: Why does the worker scan the body after `applyExperiments` instead of capturing ops during the SDK pass?**
A: `applyExperiments()` is a black box from our worker's perspective — it doesn't expose a callback for "I just applied change X". The SDK leaves `data-optly-<id>=""` markers on every modified element; reading those back is the cheapest way to discover what got applied to *this* visitor on *this* URL (audience and bucketing are evaluated inside the SDK). A productised version would build the manifest inside `applyExperiments` itself — see `CUSTOMER-GUIDE.md` § 7 for the proposed SDK-side change.

---

## Glossary

| Term | Meaning |
|---|---|
| **Edge Delivery** | Optimizely's feature that applies experiment variations at the CDN/edge worker, not in the browser snippet. |
| **Snippet** | The traditional Optimizely script tag that runs client-side; uses MutationObserver to apply variations after page load. |
| **Hydration** | The framework's step that "claims ownership" of the SSR-rendered DOM, attaches event listeners, and reconciles against the virtual DOM. |
| **Hydration recovery** | What the framework does when SSR DOM and vDOM mismatch — typically discards the SSR content and re-renders from the vDOM. |
| **Companion** | The browser-side IIFE that replays variation ops after hydration. |
| **Manifest (Optimizely project manifest)** | JSON config at `cdn.optimizely.com/js/web_sdk_v0_<snippetId>.json` describing all experiments. |
| **Manifest (companion's inline JSON)** | The `Op[]` payload the worker emits for the companion. Different thing, same word. |
| **Ops** | The companion's vocabulary for DOM modifications. Six types. See data contract above. |
| **VMAP cookie** | `OPTY$$<userId>$$<projectId>$$VMAP=<layerId>_<experimentId>_<variationId>` — set by the SDK after bucketing. Empty = visitor not bucketed. |
| **activation_type** | Page property on Optimizely Pages that determines whether changes run at the edge (`immediate`) or only client-side (`dom_changed`). |
| **data-optly-`<changeId>`** | Attribute the Optimizely SDK stamps on every element it modifies via HTMLRewriter. Used by the worker post-processor to find applied changes. |
| **data-edge-applied** | Attribute the companion stamps on every element it touches. Used for idempotency on re-runs. |
| **data-allow-mismatch** | Vue 3.5+ attribute that suppresses hydration-mismatch recovery on the element it's placed on. Optional defence-in-depth; companion is the load-bearing piece. |
