# Deployment routing — make sure the worker only runs on HTML

> Operational guide. Read after `2-engineering-handbook.md` if you are
> on the customer's engineering team, or when scoping
> production-readiness on a sales engagement. The worker MUST NOT run
> on every request that hits the customer's edge — only on HTML
> responses the variation can land in.

## The problem this guide solves

A Cloudflare Pages site receives many request types: HTML pages, JS
bundles, CSS, fonts, images, video, JSON from the customer's own APIs,
analytics pings, third-party callbacks, service-worker registrations,
sitemap fetches, `robots.txt`, favicons. None of them except HTML
benefit from the reinforcement worker. Running the worker on all of
them wastes CPU, increases your Cloudflare bill, increases tail
latency on asset delivery, and risks accidentally rewriting the body
of a non-HTML response.

The wrong default is "the worker runs on everything." The right
default is "the worker runs only where it can deliver value."

## The three-layer model

```
Request hits Cloudflare's edge
        │
        ▼
┌───────────────────────────────────────┐
│ Layer 1: _routes.json (Pages)         │ ← cheapest. Worker never invokes.
│            or wrangler routes         │   Configure once. Free at runtime.
└───────────────────────────────────────┘
        │
        ▼ (only requests that survived)
┌───────────────────────────────────────┐
│ Layer 2: shouldProcess() in worker    │ ← cheap. Worker invokes but returns
│   - method check                      │   instantly after a few cheap checks.
│   - URL extension                     │   ~1 ms.
│   - framework-internal prefixes       │
│   - Accept header                     │
└───────────────────────────────────────┘
        │
        ▼ (only HTML-bound requests)
┌───────────────────────────────────────┐
│ Layer 3: content-type check on SSR    │ ← already in the reference worker.
│   response                            │   Defence in depth.
└───────────────────────────────────────┘
        │
        ▼
   applyExperiments + post-process
```

- **Layer 1 is free** — Cloudflare's edge serves matched assets
  directly without invoking your worker.
- **Layer 2 costs ~a few hundred microseconds** of worker CPU per
  bypass. Cloudflare bills CPU time, not wall time, so an empty
  passthrough is essentially free.
- **Layer 3 is the safety net** — catches the rare case where Layer
  1 + 2 thought a request was HTML and the origin returned something
  else.

Do all three. They reinforce each other.

---

## Layer 1 — `_routes.json` (Cloudflare Pages with `_worker.js`)

Ship this file alongside `_worker.js` in `dist/`. The lab's
`target-app/build-pages.mjs` already produces one. Make it
comprehensive on the exclude side. Sample:

```json
{
  "version": 1,
  "include": ["/*"],
  "exclude": [
    "/_nuxt/*",
    "/_next/static/*",
    "/_next/image*",
    "/_next/data/*",
    "/_app/*",
    "/_payload.json",
    "/assets/*",
    "/static/*",
    "/build/*",
    "/public/*",
    "/icons/*",
    "/images/*",
    "/fonts/*",
    "/media/*",
    "/api/*",
    "/favicon.ico",
    "/robots.txt",
    "/sitemap.xml",
    "/sitemap-*.xml",
    "/manifest.webmanifest",
    "/manifest.json",
    "/sw.js",
    "/service-worker.js",
    "/ads.txt",
    "/.well-known/*"
  ]
}
```

### Syntax landmines

- `*` in `_routes.json` matches any string within a **single path
  segment**. `/*` at the end matches any subtree.
- **It does NOT support `*.ext` globs across paths.** `*.js` will not
  match `/foo/bar/baz.js`. Bucket your assets in directories (which
  every modern framework does — Nuxt under `/_nuxt/`, Next under
  `/_next/static/`, etc.).
- Hard limits: **100 includes, 100 excludes.** Plenty for any
  customer; don't try to enumerate individual files.
- Most-specific rule wins. So `include: ["/*"]` + `exclude:
  ["/assets/*"]` works exactly as expected.

### What to include in `exclude` for common frameworks

| Framework            | Add to `exclude` |
|----------------------|------------------|
| Nuxt 3 / Nuxt 4      | `/_nuxt/*`, `/_payload.json`, `/__nuxt_island/*`, `/__nuxt_error` |
| Next.js (Pages)      | `/_next/static/*`, `/_next/image*`, `/_next/data/*` |
| Next.js (App Router) | same as Pages, plus `/_next/rsc/*` if you use it |
| Remix                | `/build/*` |
| SvelteKit            | `/_app/*` |
| Astro                | `/_astro/*` |
| Generic              | `/assets/*`, `/static/*`, `/public/*` |

If the customer has API routes that return JSON (and never HTML),
include their prefix in `exclude` too — typically `/api/*`.

### For standalone Workers (not Pages)

Equivalent in `wrangler.toml`:

```toml
[[routes]]
pattern = "example.com/*"
zone_name = "example.com"
```

You can attach multiple routes; anything not matched goes straight to
origin without invoking the worker. Or attach one broad route and do
all the filtering in Layer 2.

---

## Layer 2 — `shouldProcess()` early return

For anything that slips past `_routes.json` (typically file extensions
that aren't bucketed by directory, like a one-off `/something.json` at
the page level), add a fast pre-check at the top of the worker.

The drop-in helper lives at `code/should-process.ts`. Reproduced
verbatim here so you can read it without flipping files:

```ts
const ASSET_EXTENSION_RE =
  /\.(js|mjs|css|map|json|xml|txt|csv|pdf|png|jpe?g|gif|svg|ico|webp|avif|bmp|tiff?|woff2?|ttf|otf|eot|mp[34]|m4[av]|webm|wav|ogg|flac|zip|gz|br|wasm)(\?.*)?$/i;

const FRAMEWORK_PREFIXES = [
  '/_nuxt/', '/_next/', '/_app/', '/_payload',
  '/__nuxt_island/', '/__nuxt_error',
  '/_astro/',
  '/.well-known/',
  '/api/',
  '/cdn-cgi/'
];

export function shouldProcess(request: Request): boolean {
  // Only verbs that can return HTML worth modifying.
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;

  const url = new URL(request.url);

  // Asset extension at the end of the path.
  if (ASSET_EXTENSION_RE.test(url.pathname)) return false;

  // Framework-internal endpoints.
  if (FRAMEWORK_PREFIXES.some(p => url.pathname.startsWith(p))) return false;

  // Accept header sanity — if the client isn't asking for HTML,
  // skip. Browsers asking for HTML send
  // 'text/html,application/xhtml+xml,…'. fetch() and background
  // pings usually do not.
  const accept = request.headers.get('accept') || '';
  if (accept && !accept.includes('text/html') && !accept.includes('*/*')) {
    return false;
  }

  return true;
}
```

Wired into the worker entry:

```ts
import { shouldProcess }                from './optimizely-companion/should-process';
import { handleRequestWithReinforcement } from './optimizely-companion/worker-integration';
import { COMPANION_SOURCE }              from './optimizely-companion/companion-source.mjs';

(globalThis as any).COMPANION_SOURCE = COMPANION_SOURCE;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!shouldProcess(request)) {
      // Straight passthrough — no SDK call, no post-process.
      return yourSsrHandler.fetch(request, env, ctx);
    }
    return handleRequestWithReinforcement(
      request, env, ctx,
      (req) => yourSsrHandler.fetch(req, env, ctx)
    );
  }
};
```

For the lab's reference worker (`target-app/server/edge-entry.ts`),
`shouldProcess()` is called at the top of the `fetch` handler before
the existing diagnostic and SSR logic.

---

## Layer 3 — content-type check (already shipping)

In `code/worker-integration.ts` you'll find:

```ts
const ct = ssrResponse.headers.get('content-type') || '';
if (ssrResponse.status !== 200 || !ct.toLowerCase().includes('text/html')) {
  return ssrResponse;
}
```

Do not remove. It catches the case where Layer 1 + 2 routed a request
through as "probably HTML" and the origin returned a streaming JSON,
a 30x redirect, a 4xx/5xx error page, or some content negotiated
weirdly. The reinforcement worker never injects into anything that
isn't a `200 text/html`.

---

## What NOT to exclude

These ARE HTML and must route through the worker:

- **Pages without extensions:** `/`, `/about`, `/products/sofa-ektorp`,
  `/hire/cs/pricing`.
- **Pages with `.html` / `.htm`:** `/about.html`. The asset-extension
  regex in `shouldProcess()` deliberately does NOT list `html` or
  `htm`.
- **Trailing-slash URLs:** `/about/`.
- **Locale prefixes:** `/en-gb/products/...`, `/sv-se/...`.
- **Query strings on HTML pages:** `/products?category=outdoor`. The
  asset regex anchors to the path, not the query.

Other landmines:

- Don't `exclude` `/api/*` if the customer's app actually serves HTML
  from `/api/` (rare but happens, e.g. embedded mini-apps).
- Don't `exclude` `/admin/*` until the customer confirms — admin
  pages often serve HTML even if they aren't valid experiment
  targets.
- Don't try to filter by User-Agent in `_routes.json` — that's not
  what it's for and it ages badly.

---

## How to verify the filtering

After deploying with `_routes.json` + `shouldProcess()`:

1. **Cloudflare Pages dashboard → Functions → Real-time logs.** Hit a
   page that serves an image. You should NOT see a worker invocation.
   Hit the HTML page. You SHOULD see one.

2. **Curl with `-I` on an asset:**
   ```bash
   curl -I https://customer.pages.dev/_nuxt/entry.abc123.js
   ```
   Response should NOT carry the `x-optly-edge` header (or whatever
   diagnostic header your worker stamps). If it does, the route
   slipped through.

3. **Curl on an HTML page:**
   ```bash
   curl -I https://customer.pages.dev/some-page
   ```
   Should carry the diagnostic header.

4. **Cloudflare Workers analytics.** Look at requests per second
   against expected HTML volume. If you're seeing 10× expected
   invocations, the filter is leaking.

5. **Spot-check the response body** of an asset request to confirm
   no injected `<script id="edge-del-v2-companion">` ended up inside a JS
   file. If you ever see this, the worker is processing non-HTML —
   stop and audit Layer 1/2 immediately.

---

## Cost framing for customer conversations

If their site does 10M HTML requests/month and 100M asset requests/
month, Layer 1 alone prevents 100M worker invocations. At
Cloudflare's pricing tier transitions, that can be the difference
between two adjacent billing brackets. More importantly, it removes
100M cold-path CDN-fetch+wrapper trips that would add nothing to
the user experience.

When pitching Edge Delivery to a performance-sensitive customer
(IKEA, Indeed, GitLab), lead with this. They will assume the worker
runs on every request unless told otherwise.

---

## Where the artefact lives in this repo

| Artefact | Path |
|---|---|
| This guide | `reinforcement-layer/training-pack/4-deployment-routing.md` |
| Drop-in filter | `reinforcement-layer/training-pack/code/should-process.ts` |
| Worker integration that calls it | `reinforcement-layer/training-pack/code/worker-integration.ts` |
| Lab reference `_routes.json` | `target-app/dist/_routes.json` (generated by `build-pages.mjs`) |
| Mention in AGENTS.md | `reinforcement-layer/AGENTS.md` → "Routing & cost" |
