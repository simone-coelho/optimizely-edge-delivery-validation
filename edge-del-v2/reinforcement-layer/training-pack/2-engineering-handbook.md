# Engineering handbook — what to install and where

You are the engineer doing the integration. Two install points: your
edge worker, and (optionally) your browser bundle. This document
gives you the exact code to copy, the exact files to put it in, and
the exact steps to verify it works.

Reference implementation is in this repo at
`edge-del-v2/target-app/server/edge-entry.ts` (worker) and
`edge-del-v2/reinforce/src/` (companion). Live at
<https://edge-del-v2-target.pages.dev/>.

---

## Part 1 — Edge worker

You already have a Cloudflare worker that calls
`applyExperiments()` from `@optimizely/edge-delivery` and returns the
result. You will wrap it with a post-processor that injects a small
inline companion script.

### What you are adding, conceptually

```
your existing worker                            you add this
─────────────────────                           ─────────────────────
SSR handler returns Response                    (no change)
                ↓
applyExperiments(request, ctx, { control })     (no change)
returns variation-applied Response
                ↓
return that Response  ──────────────────────►   post-process:
                                                 1. read body
                                                 2. scan for
                                                    data-optly-<id>
                                                    markers
                                                 3. build manifest
                                                 4. inject <script>
                                                    before </body>
                                                 5. return new
                                                    Response
```

Zero extra HTTP requests. Zero extra runtime cost beyond a single
body read and one regex scan.

### Step 1 — copy the `code/` folder into your repo

There is no npm package for this yet. The reference implementation
ships as plain source files in this training pack, at
`reinforcement-layer/training-pack/code/`. Vendor the whole folder
into your project:

```bash
cp -r reinforcement-layer/training-pack/code/  your-app/src/optimizely-companion/
```

You now have eight files in your project:

```
src/optimizely-companion/
├── worker-integration.ts     ← Cloudflare worker post-processor (the wrapper you wire into your fetch handler)
├── should-process.ts         ← request filter — bypass non-HTML requests at the top of the worker
├── companion.ts              ← browser companion (TypeScript source)
├── ops.ts                    ← DOM operation primitives
├── types.ts                  ← shared Op type
├── build-companion.mjs       ← esbuild script — produces companion.min.js + companion-source.mjs
├── companion.min.js          ← pre-built minified IIFE (drop-in for Mode 2 installs — see Part 2)
└── README.md                 ← what each file is, how it wires together
```

### Step 2 — install esbuild (one dev dependency)

```bash
npm install --save-dev esbuild
```

### Step 3 — build the companion artifacts

```bash
cd src/optimizely-companion
node build-companion.mjs
```

This writes two files next to the sources:

- `companion.min.js` — minified IIFE, ~11 KB raw, ~3 KB gzipped.
- `companion-source.mjs` — exports `COMPANION_SOURCE` as a string
  that your worker imports and inlines into the response body.

Add `node build-companion.mjs` to your existing build pipeline so
these artifacts regenerate on every deploy.

### Step 4 — wire `worker-integration.ts` into your worker entry

Open your existing Cloudflare worker entry file (the one that calls
`applyExperiments()` today). Replace the body of its `fetch` handler
with a call to `handleRequestWithReinforcement`:

```ts
import { handleRequestWithReinforcement } from './optimizely-companion/worker-integration';
import { COMPANION_SOURCE }                from './optimizely-companion/companion-source.mjs';

// worker-integration.ts expects COMPANION_SOURCE as a module-scope
// symbol. Provide it via globalThis right after importing.
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

That's the entire wiring. The wrapper itself lives in
`worker-integration.ts` — read it once to confirm what it does, then
treat it as a black box.

If your worker bundler supports raw-text imports (esbuild's `text`
loader, webpack's `raw-loader`, Vite's `?raw` suffix), you can skip
the `companion-source.mjs` artifact entirely and import
`companion.min.js?raw` directly. The build script is provided for
worker setups without raw-text imports.

### Step 5 — deploy and confirm headers

```bash
npx wrangler deploy
```

Open a page that has an experiment running. DevTools → Network →
click the document request → Response headers. You should see a
header you set (optional but recommended):

```
x-edge-del-v2: mode=pages-integrated; snippet=<id>; reinforce=on
```

In the response body, View Source should now contain near the
bottom:

```html
<script type="application/json" id="edge-del-v2-manifest">{"ops":[…]}</script>
<script id="edge-del-v2-companion">!function(){…}()</script>
```

### Optional but recommended: a kill-switch query parameter

The reference lab uses `?reinforce=off` to bypass injection — useful
for support tickets, A/B comparison, and on-call diagnosis:

```ts
const reinforce = new URL(request.url).searchParams.get('reinforce') !== 'off';
// ... and skip Step 3's injection if !reinforce
```

---

## Part 2 — Browser / client (Mode 1 vs Mode 2)

There are two install modes for getting the companion onto the page.
The runtime behavior is identical between them; the difference is who
delivers the companion's JavaScript to the browser.

- **Mode 1 — worker inlines the companion.** Part 1's worker
  integration uses this pattern. Once your worker is deployed, the
  companion is in every response. Your application code adds
  nothing. The only thing your React or Vue components need to do is
  dispatch a `CustomEvent('edge-del-v2-hydrated')` from a mount
  handler (snippets in §"Hydration-signal dispatch" below).
- **Mode 2 — your application code installs the companion.** Vendor
  the companion file into the application repository, deliver it
  through your existing application JS pipeline. Two flavors:
  - **Flavor 2a** — drop `companion.min.js` into static assets and
    reference it via a `<script src>` tag in your root layout.
  - **Flavor 2b** — vendor the source under `/lib/vendor/` and add
    a side-effect import to your application entry so your bundler
    pulls the companion into the main JS artifact.
  Configure `worker-integration.ts` to omit the companion inline emit
  (one-line change documented at the bottom of this section).

Pick the mode that fits your operational model. The decision matrix
is in CUSTOMER-GUIDE.md § 8.3; the short version:

|                                                       | Mode 1                              | Mode 2                                  |
| ----------------------------------------------------- | ----------------------------------- | --------------------------------------- |
| Where the companion lives in the response             | Inline `<script>` from worker       | `<script src>` or bundled into app JS   |
| Who owns the deploy of the companion                  | Worker repository                   | Application repository                  |
| Application template changes required                 | None                                | `<script src>` tag (2a) or `import` (2b) |
| Application bundle size impact                        | None                                | None (2a) or +~11 KB (2b)               |
| CSP `'unsafe-inline'` required for `script-src`       | Yes (or per-request nonce)          | No                                      |
| Companion version pinning                             | Pinned by worker repository         | Pinned by application repository        |
| Coordinating worker team and app team for updates     | Required                            | Not required                            |

### Hydration-signal dispatch (required in every mode)

In every install mode, the application code dispatches
`CustomEvent('edge-del-v2-hydrated')` once the framework's root tree
has hydrated. The companion listens for this event at boot and runs
the apply on first dispatch.

**Next.js App Router** (`app/layout.tsx`):

```tsx
'use client';
import { useEffect } from 'react';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('edge-del-v2-hydrated'));
  }, []);
  return <html><body>{children}</body></html>;
}
```

**Next.js Pages Router** (`pages/_app.tsx`):

```tsx
import { useEffect } from 'react';

export default function App({ Component, pageProps }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('edge-del-v2-hydrated'));
  }, []);
  return <Component {...pageProps} />;
}
```

**Vue / Nuxt** — optional, since the Nuxt adapter auto-detects on
boot via `useNuxtApp().hook('app:mounted', …)`. The custom-event
dispatch is supported as an explicit-timing alternative; the
one-shot apply gate ensures whichever fires first wins.

```vue
<!-- app.vue -->
<script setup>
import { onMounted } from 'vue';
onMounted(() => {
  window.dispatchEvent(new CustomEvent('edge-del-v2-hydrated'));
});
</script>
```

### Mode 2 — additional steps to deliver the companion from app code

If you picked Mode 2, you have two flavors. Pick one.

#### Flavor 2a — static asset + script tag

Add a step to your build pipeline that copies
`src/optimizely-companion/companion.min.js` into your public assets
directory:

```json
// package.json — alongside your existing scripts
"scripts": {
  "build:companion": "node src/optimizely-companion/build-companion.mjs && cp src/optimizely-companion/companion.min.js public/edge-del-v2-companion.min.js"
}
```

Add a `<script src>` tag to your root layout pointing at the hosted
file:

```html
<script src="/edge-del-v2-companion.min.js" defer></script>
```

(In Next.js Pages Router, the tag goes in `pages/_document.tsx`;
in App Router it goes inside `<body>` of `app/layout.tsx`. See
CUSTOMER-GUIDE.md § 8.7.2 for the exact placement.)

#### Flavor 2b — vendored import bundled into application JS

Move `companion.min.js` into your application source tree (e.g.
`/lib/vendor/`), then add a side-effect import to your application
entry point so your bundler picks it up:

```ts
// In app/layout.tsx, pages/_app.tsx, or app.vue
import '@/lib/vendor/edge-del-v2-companion.min.js';
```

The companion's IIFE runs as part of the application bundle's
normal load — no separate `<script>` tag needed.

#### Configuring the worker to omit the companion inline emit

In both Mode 2 flavors, `worker-integration.ts` should NOT emit the
companion inline. Comment out (or remove) the companion `<script>`
line where the wrapper builds the injection string:

```ts
// in worker-integration.ts, the injection that originally read:
const injection =
  `<script type="application/json" id="${MANIFEST_TAG_ID}">${manifestJson}</script>` +
  `<script id="${COMPANION_TAG_ID}">${COMPANION_SOURCE}</script>`;

// becomes (Mode 2 — application code delivers the companion):
const injection =
  `<script type="application/json" id="${MANIFEST_TAG_ID}">${manifestJson}</script>`;
```

The inline JSON manifest is still emitted — the companion needs it
to know what to replay. Only the companion `<script>` itself moves
from the worker to the application code.

### Nonce'd inline tag — strict CSP variant of Mode 1

If you want to stay in Mode 1 (worker inlines) but your CSP doesn't
allow `'unsafe-inline'`, plumb your nonce through the worker:

```ts
// in worker-integration.ts, replace:
`<script id="${COMPANION_TAG_ID}">${COMPANION_SOURCE}</script>`
// with:
`<script id="${COMPANION_TAG_ID}" nonce="${nonce}">${COMPANION_SOURCE}</script>`
```

Set `Content-Security-Policy: script-src 'self' 'nonce-<value>'` per
your standard. The nonce comes from wherever your existing nonce
plumbing generates it.

---

## Part 3 — Verify it works

Five things to check on a page that has a running experiment:

1. **Manifest tag is in the SSR body.** View Source → search
   `edge-del-v2-manifest`. You should find a `<script
   type="application/json">` with an `"ops"` array.

2. **Companion ran.** DevTools console → type:
   ```js
   __EDGE_DEL_V2__
   ```
   You should see `{ manifest: {…}, ranAt: …, events: [...] }`.
   The `events` array should contain `boot:armed`,
   `hydration:nuxt-hook-armed` (or your framework's equivalent), and
   `initial:applied`.

3. **Variation present after hydration.** Pick a DOM marker your
   experiment edits and inspect it post-hydration. The element
   should also carry `data-edge-applied="…"` (the companion's
   idempotency mark).

4. **SPA navigation preserves the variation.** Click a same-origin
   link (Nuxt's `<NuxtLink>`, Next.js's `<Link>`). On arrival back at
   a variation page, the variation should still be present.

5. **No console errors.** A clean install produces no
   `[reinforce]` errors. `[Vue warn]` about hydration mismatches is
   expected on the initial load for pages with edge variations —
   that's the failure mode the companion exists to cover. The mark
   of success is that the warning appears and the variation stays.

### If verification fails

| Symptom                                          | Most likely cause                                        | Fix                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `__EDGE_DEL_V2__` is undefined                   | Companion `<script>` not in body                         | Check the worker's response body for the injection. CSP probably blocked it; switch to nonce or asset. |
| Manifest tag present, but `ops: []`              | `applyExperiments()` didn't apply anything for this URL  | Check VMAP cookie. Empty VMAP = audience/URL miss. See SA playbook § "VMAP empty".                     |
| Companion fires, but variation still disappears  | Framework adapter isn't waiting for the right signal     | See § "Adding a new framework adapter" below.                                                          |
| Variation present cold, gone after SPA nav       | Companion's history hooks didn't install                 | Check console for the `route:history-patched` event. Verify your router actually uses History API.     |

---

## Part 4 — Adding a new framework adapter

The companion ships with adapters for Vue 3.5 / Nuxt 3 and a
React 18 / Next.js sketch. To add a new framework, edit one file in
the reinforce package:

```ts
// reinforce/src/adapters/<your-framework>.ts
export function waitForFrameworkMount(cb: () => void): void {
  // Three patterns to try, in order:
  //
  // 1. Lifecycle hook (preferred). Examples:
  //      Vue/Nuxt: useNuxtApp().hook('app:mounted', cb)
  //      React:    queueMicrotask after the first useEffect
  //      Svelte:   onMount()
  //
  // 2. Root-instance polling. Find the framework's app root in
  //    the DOM, read a "is mounted" flag. Poll per animation
  //    frame, give up after ~500ms.
  //
  // 3. requestIdleCallback fallback. Generic, always works,
  //    slowest first-apply by 1-2 frames.
}
```

Plus a hook for SPA-navigation re-apply:

```ts
export function onRouteChange(cb: () => void): () => void {
  // Hook into the router's after-each / page-finish event.
  // Return an unsubscribe function. The companion will call
  // this after every history.pushState / replaceState / popstate.
}
```

Pattern documented in detail in
`reinforcement-layer/CUSTOMER-GUIDE.md` § 8.7.3.

---

## Part 5 — Bundle size, performance, security

- **Companion bundle:** ~11 KB minified, ~3 KB gzipped.
- **Worker per-request overhead:** one body read, one regex scan,
  one cdn.optimizely.com fetch (cached). Sub-millisecond on a warm
  cache.
- **Mode 1 — no external requests on the browser side.** The
  companion is inlined; the manifest is inlined.
- **Mode 2 — one same-origin request (flavor 2a) OR zero extra
  requests (flavor 2b, companion is in the application JS artifact).**
  The inline manifest is still emitted by the worker in either mode.
- **CSP:** Mode 2 covers `script-src 'self'` cleanly; Mode 1 needs
  `'unsafe-inline'` or per-request nonces. See Part 2.
- **Cookies:** unchanged from your existing Edge Delivery install.
  No new cookies.
- **PII:** the manifest contains DOM selectors and HTML payloads
  authored in Optimizely. No request data, no user identifiers, no
  cookie values. Same surface as the snippet would carry.
