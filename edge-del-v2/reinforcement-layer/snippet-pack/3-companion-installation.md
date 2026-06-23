# 3 — Installing the reinforcement companion

The companion is one TypeScript file plus shared primitives. On SCA,
the simplest path is to **paste the built companion into Optimizely's
Project JavaScript pane** — no SCA repo changes beyond the snippet
`<script>` tag from `1-snippet-placement.md`.

## What you need

Five files, all in this pack's `code/` folder:

| File | Purpose |
|---|---|
| `code/companion.ts` | Extract+replay engine with framework adapters (Backbone / Nuxt / generic) |
| `code/ops.ts` | Idempotent DOM mutation primitives |
| `code/types.ts` | Op vocabulary |
| `code/suitecommerce-init.ts` | Sets `window.__EDGE_DEL_V2_CONFIG__` with `framework: 'backbone'` and the project's `regionRoots` |
| `code/revenue.ts` | LiveOrder.Model read and dedup'd push to Optimizely on the Thank-You page (see `5-revenue-tracking.md`) |

The `code/` folder is self-contained — Mystery Ranch can vendor the
entire folder into their repo, or you can ship a built bundle of its
contents for paste into Project JavaScript. See `code/README.md` for
the build recipe.

## Two installation paths

### Path A — Project JavaScript (recommended; no SCA repo changes)

1. Build the companion to a single IIFE.

   ```bash
   cd training-pack/code
   node ../../reinforce/build.mjs   # writes dist/companion.min.js
   ```

   (If you don't have a Node environment handy, the pre-built file is
   in the repo at `edge-del-v2/reinforce/dist/companion.min.js` — same
   artifact.)

2. Open the Optimizely project → Settings → **Project JavaScript**.

3. At the **top** of the pane, paste the SuiteCommerce init:

   ```js
   // SuiteCommerce Advanced — companion configuration.
   // Sets the framework to Backbone, lists the SCA view regions
   // whose re-render destroys variation DOM, and tunes the
   // observer debounce.
   window.__EDGE_DEL_V2_CONFIG__ = {
     framework: 'backbone',
     regionRoots: [
       '#main-content',
       '#mini-cart',
       '#cart-summary',
       '#facets-sidebar',
       '#product-grid'
     ],
     rerenderDebounceMs: 75
   };
   ```

4. **Below** the config, paste the contents of
   `dist/companion.min.js` verbatim.

5. Publish the project.

That's it. The snippet loads → Project JavaScript runs → config object
set → companion IIFE executes → Backbone adapter selected by
auto-detect → adapter wires `Backbone.history.on('route', …)`,
`hashchange`, history-API patches, and the regionRoots observers.

### Path B — SCA repo (only if you can't use Project JavaScript)

Some teams prefer to vendor the companion in the SCA repo so it goes
through the same source review and version control as the rest of
the storefront.

1. Copy the five files (companion.ts, ops.ts, types.ts,
   suitecommerce-init.ts, revenue.ts) into
   `Modules/extensions/OptimizelyCompanion@1.0.0/JavaScript/` (or
   whatever path matches your extension naming convention).

2. Add an entry to the extension's `ns.package.json`:

   ```json
   {
     "type": "extension",
     "javascript": {
       "application": {
         "shopping": [
           "JavaScript/suitecommerce-init.js",
           "JavaScript/companion.js"
         ],
         "myaccount": [
           "JavaScript/suitecommerce-init.js",
           "JavaScript/companion.js"
         ],
         "checkout": [
           "JavaScript/suitecommerce-init.js"
         ]
       }
     }
   }
   ```

   The companion file is NOT loaded on the checkout application —
   reduces risk of any DOM interference with native checkout
   validation. See `4-checkout-safety.md`.

3. Re-deploy SCA.

The Project JavaScript path (A) is simpler and the more common choice.
SCA repo path (B) is for teams with formal change-control for
storefront code.

## Verifying the install

Open the storefront in a browser. DevTools console:

```js
window.__EDGE_DEL_V2__
```

You should see an object with `events: [...]` populated. Look for:

```
boot:armed
adapter:auto-selected   → 'backbone'
hydration:backbone-ready
route:backbone-hook-armed
rerender:armed          → '#main-content'  (and one per regionRoot)
```

If you see `adapter:auto-selected → 'generic'` or `'nuxt'` instead of
`'backbone'`, the Backbone global isn't visible from where the
companion is running. Confirm:

```js
typeof window.Backbone?.history
// → 'object'  (if Backbone is loaded)
```

If `'undefined'`, the snippet is firing before SCA has loaded
Backbone. This shouldn't happen because the snippet only kicks the
companion off after `whenReady`, which polls for `Backbone.history.started`.
But if it does, force the framework:

```js
window.__EDGE_DEL_V2_CONFIG__ = {
  framework: 'backbone',
  ...
};
```

(This is what the suitecommerce-init.ts file does. Don't skip it —
auto-detection is a convenience, the explicit pin is the safe path.)

Triggering a route change:

```js
// 1. Navigate to a route. DevTools should log:
window.__EDGE_DEL_V2__.events.slice(-5)
// → includes 'backbone:route:<route-name>' and 'route:applied'
```

Triggering a section re-render:

```js
// 1. Open the mini-cart (click the cart icon).
window.__EDGE_DEL_V2__.events.slice(-5)
// → includes 'rerender:#mini-cart' and 'route:applied'
```

## What if a variation isn't surviving?

Run this in DevTools:

```js
const log = window.__EDGE_DEL_V2__.events;
log.filter(e => e.kind.startsWith('op:error') || e.kind === 'rerender:error' || e.kind === 'route:error');
```

Most likely causes:

1. **`op:error` with `Failed to execute 'querySelector'`** — Optimizely's
   `selector` is a CSS expression Backbone's view doesn't expose with
   that exact name. Re-inspect the rendered DOM and update the
   experiment's variation selector.

2. **`rerender:root-not-found`** — A regionRoot selector in your
   `__EDGE_DEL_V2_CONFIG__` doesn't match anything on this view. Not
   fatal; the companion still works for other roots. Remove or
   correct the selector.

3. **No errors but variation still wiped** — DSW is undoing the
   variation. Check: in Optimizely UI, is the Page's Activation
   Type "DOM Change" (correct) or "Immediate" (problematic for SCA)?
   Switch to DOM Change.

## How the companion picks the Backbone adapter

The companion has three adapters (Backbone, Nuxt, generic). It picks
in this order:

```js
// Pseudocode of the actual selection in companion.ts boot()
if (config.framework && config.framework !== 'auto') {
  use config.framework;             // explicit pin wins
} else {
  for (each adapter in priority order) {
    if (adapter.detect()) use adapter;
  }
}
```

Priority: **backbone → nuxt → generic**. So:

- `suitecommerce-init.ts` sets `framework: 'backbone'` →
  explicit pin → backbone adapter used.
- If you forgot to set the config and SCA has `window.Backbone.history`,
  auto-detect picks backbone.
- If neither, falls through to nuxt detection (Nuxt globals or
  `__vue_app__` root), then to generic (pushState only).

The explicit pin in suitecommerce-init.ts is the recommended path. The
auto-detect priority is the safety net.
