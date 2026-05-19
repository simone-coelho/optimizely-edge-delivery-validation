# Drop-in code — copy these files into your project

These six files are the entire reinforcement layer. There is no npm
package to install — Optimizely hasn't published one yet. You vendor
these files directly into the customer's repository.

## What each file is

| File                       | What it is                                                                                       | Goes where in the customer's repo |
| -------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------- |
| `worker-integration.ts`    | The Cloudflare worker post-processor. Wraps `applyExperiments()`, scans the response for Optimizely markers, injects the companion `<script>` before `</body>`. | Wherever the customer's edge worker entry lives — typically `src/worker/` or `server/`. |
| `companion.ts`             | The browser companion (TypeScript source). Reads the inline manifest after the framework hydrates and idempotently replays variation ops. | `src/optimizely-companion/` or equivalent. |
| `ops.ts`                   | DOM operation primitives the companion uses (text, attribute, class, add, remove, move). Per-root reconciliation handles multi-root `insert_html` payloads. | Same folder as `companion.ts`. |
| `types.ts`                 | Shared `Op` / `VariationManifest` types. Imported by both `companion.ts` and `worker-integration.ts`. | Same folder. |
| `build-companion.mjs`      | Build script. Runs esbuild to produce `companion.min.js` (the minified IIFE) and `companion-source.mjs` (an ESM module exporting the IIFE as a string for the worker to inline). | Same folder. |
| `companion.min.js`         | Pre-built minified browser IIFE — ~8 KB raw, under 2 KB gzipped. Drop into your public assets if your CSP forbids inline scripts and you can't run the build. | Reference build — you'll regenerate it via `build-companion.mjs` after any edit. |

## How to use these files

### Step 1 — copy the folder into the customer's repo

```bash
cp -r training-pack/code/ customer-repo/src/optimizely-companion/
```

(Pick whatever path fits the customer's source tree. Keep all six
files together.)

### Step 2 — install esbuild for the build script

In the customer's repo:

```bash
npm install --save-dev esbuild
```

### Step 3 — run the build to produce `companion-source.mjs`

```bash
cd customer-repo/src/optimizely-companion
node build-companion.mjs
```

This writes `companion.min.js` and `companion-source.mjs` next to
the sources. The worker imports the latter; the former is the
fallback for CSP-restricted environments.

Wire the build into the customer's regular build pipeline so the
artifacts regenerate on every deploy.

### Step 4 — import `worker-integration.ts` from the customer's worker entry

The customer already has a worker entry file calling
`applyExperiments()`. Replace the body of its `fetch` handler with a
call to `handleRequestWithReinforcement` exported from
`worker-integration.ts`:

```ts
import { handleRequestWithReinforcement } from './optimizely-companion/worker-integration';
import { COMPANION_SOURCE }                from './optimizely-companion/companion-source.mjs';

// worker-integration.ts expects COMPANION_SOURCE as a module-scope
// symbol. The cleanest pattern is to provide it on globalThis right
// after the import:
(globalThis as any).COMPANION_SOURCE = COMPANION_SOURCE;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handleRequestWithReinforcement(
      request,
      env,
      ctx,
      // your existing SSR fetcher (Nuxt nitro, Next edge handler, etc.)
      (req) => yourSsrHandler.fetch(req, env, ctx)
    );
  }
};
```

(If your worker bundler supports raw-text imports — esbuild's `text`
loader, webpack's `raw-loader`, Vite's `?raw` suffix — you can skip
the `companion-source.mjs` generation entirely and import
`companion.min.js?raw` directly. The build script is provided for
worker setups without raw-text imports.)

### Step 5 — deploy and verify

Deploy the worker. Open a page that has a running edge experiment.
DevTools console:

```js
__EDGE_DEL_V2__
```

You should see the companion's events log including
`initial:applied`. View Source on the response should contain two
`<script>` tags near the bottom: the JSON manifest and the inline
companion.

## Modifying the companion

If you need to add a framework adapter, change idempotency markers,
or tune the SPA-navigation hook timing — edit `companion.ts` (or
`ops.ts` for the DOM primitives), then re-run `node
build-companion.mjs`. The TypeScript sources are the canonical
artifact; everything else is built from them.

## Reference lab

The same six files live in this repo at
`edge-del-v2/reinforce/src/` (companion sources),
`edge-del-v2/reinforce/build.mjs` (build script), and
`edge-del-v2/target-app/server/edge-entry.ts` (worker integration,
with extra training-mode query parameters layered on). The
`code/` files in this folder are a slimmed extract of those — same
code, no Nuxt-specific or lab-specific scaffolding.
