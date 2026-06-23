# SuiteCommerce Advanced — drop-in code

Five TypeScript files. Self-contained — vendor this entire `code/`
folder into the customer's repo or paste its contents into Optimizely
Project JavaScript.

## What each file is

| File | Purpose | Origin |
|---|---|---|
| `companion.ts` | The extract+replay engine. Reads `window.optimizely.get('data')` on every framework signal (initial ready, Backbone route change, region re-render), normalizes each change to an Op, applies idempotently. | Shared engine — same file ships in the Edge Delivery training-pack. The Backbone adapter is one of three in this file. |
| `ops.ts` | Idempotent DOM mutation primitives (text / attribute / class / add / remove / move). Multi-root reconciliation for `insert_html` changes. | Shared engine. |
| `types.ts` | The `Op` and `VariationManifest` types. | Shared engine. |
| `suitecommerce-init.ts` | Sets `window.__EDGE_DEL_V2_CONFIG__` with `framework: 'backbone'` and the SCA region root selectors. Suppresses region observers on `/checkout/*`. | SuiteCommerce-specific. |
| `revenue.ts` | `trackRevenue()` — reads `LiveOrder.Model` on Thank-You page, dedup'd push to Optimizely. | SuiteCommerce-specific. |

## Two installation paths

### Path A — Project JavaScript (recommended; no SCA repo changes)

Customer pastes the compiled bundle into Optimizely → Settings →
Project JavaScript. You ship the customer a **pre-built JS bundle**
they paste verbatim, plus the snippet `<script>` tag for the SSP
shell (`../1-snippet-placement.md`).

How to build the bundle for shipping:

```bash
# From the kit root
cd edge-del-v2/reinforce
node build.mjs                  # writes dist/companion.min.js (~10 KB)
```

The companion source the build reads from is
`reinforce/src/companion.ts` (the same engine file shipped in this
folder). The build produces a minified IIFE that includes all three
adapters; the Backbone adapter is selected at runtime because
`suitecommerce-init.ts` pins it.

What to actually paste, in this order, into Project JavaScript:

```
1. suitecommerce-init.ts compiled to JS  (~30 lines)
2. dist/companion.min.js                   (~10 KB minified)
3. revenue.ts compiled to JS               (~150 lines)
4. trackRevenue({});                       (one line, kicks off step 3)
```

For the customer, items 1, 2, 3, 4 land as one block in Project
JavaScript. Steps 1 and 3 are TypeScript in this repo; you'll need to
strip the type annotations by hand or run them through any TS → JS
compiler (`tsc`, `esbuild --loader=ts`, online). The companion.min.js
artifact is already compiled JS.

### Path B — SCA extension repo

Vendor the five `.ts` files into a SuiteCommerce extension. The team
already running `gulp extension:create-module` knows the recipe;
they'll convert the `.ts` files to `.js` as part of their normal
build. Recommended `ns.package.json` layout:

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
        "JavaScript/revenue.js"
      ]
    }
  }
}
```

Note `companion.js` is NOT loaded on `checkout`. Only `revenue.js`
runs there. See `../4-checkout-safety.md`.

## What about staying in sync with the Edge Delivery pack

The `companion.ts`, `ops.ts`, and `types.ts` files in this folder are
**copies** of the same files in `../../training-pack/code/`. If
either pack fixes a bug in the engine, the fix has to be applied to
both copies. The duplication is intentional — it makes the
snippet-pack folder a self-contained customer deliverable that ships
without external references.

To re-sync from the source of truth:

```bash
cp ../../training-pack/code/{companion,ops,types}.ts ./
```

(Run from this `snippet-pack/code/` directory.)

## Verifying after install

See `../3-companion-installation.md` for the full DevTools-console
verification checklist.
