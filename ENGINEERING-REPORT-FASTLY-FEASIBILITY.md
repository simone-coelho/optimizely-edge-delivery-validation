# Edge Delivery SDK — Fastly Compute Feasibility Assessment

**Date**: March 20, 2026
**Purpose**: Evaluate what it would take to run the Optimizely Edge Delivery SDK on Fastly Compute
**Status**: Feasible — no architectural blockers

---

## 1. Executive Summary

The Optimizely Edge Delivery SDK can be ported to Fastly Compute with moderate effort. The core HTML rewriting capability — the most critical dependency — is not a blocker. Fastly's native `HTMLRewritingStream` is built on the exact same Rust library (`lol-html`) that powers Cloudflare's `HTMLRewriter`. The API surface differs, but the underlying engine is identical.

The experiment decision logic, cookie handling, variation mapping, and all business logic in the SDK is pure JavaScript and runs on any runtime without modification.

The work breaks down to:
- An HTMLRewriter API adapter (~100 lines)
- Fetch call updates for Fastly backend declarations (~20 lines)
- Cache control translation (~10 lines)
- Testing and validation

---

## 2. Platform Comparison

### HTML Rewriting

Both platforms use the same underlying engine: [lol-html](https://github.com/cloudflare/lol-html), an open-source streaming HTML parser/rewriter written in Rust by Cloudflare.

**Cloudflare Workers — `HTMLRewriter`**
```javascript
const rewriter = new HTMLRewriter()
  .on("h1", {
    element(el) { el.setInnerContent("Modified"); }
  })
  .on("head", {
    element(el) { el.append('<script src="..."></script>', { html: true }); }
  });

return rewriter.transform(response);
```

**Fastly Compute — `HTMLRewritingStream`** (available since JS SDK v3.35.0)
```javascript
import { HTMLRewritingStream } from "fastly:html-rewriter";

const transformer = new HTMLRewritingStream()
  .onElement("h1", (el) => el.setInnerContent("Modified"))
  .onElement("head", (el) => el.append('<script src="..."></script>', { html: true }));

const transformedBody = response.body.pipeThrough(transformer);
return new Response(transformedBody, response);
```

Key differences:

| Aspect | Cloudflare `HTMLRewriter` | Fastly `HTMLRewritingStream` |
|--------|--------------------------|------------------------------|
| Handler registration | `.on(selector, { element(el) {...} })` | `.onElement(selector, (el) => {...})` |
| Text handlers | `.on(selector, { text(chunk) {...} })` | `.onText(selector, (chunk) => {...})` |
| Comment handlers | `.on(selector, { comments(c) {...} })` | `.onComments(selector, (c) => {...})` |
| Document handlers | `.onDocument({ doctype(d) {...} })` | `.onDoctype((d) => {...})` |
| Transform | `.transform(response)` returns new Response | `.pipeThrough()` returns ReadableStream |
| Element methods | `prepend`, `append`, `setInnerContent`, `setAttribute`, `removeAttribute`, `before`, `after`, `remove` | Same methods — identical element API |
| Integration | Wraps full Response object | Integrates with Web Streams API |
| Performance | Native (lol-html compiled into runtime) | Native (lol-html compiled into runtime) |

The element manipulation methods (`prepend`, `append`, `setInnerContent`, `setAttribute`, `removeAttribute`, `before`, `after`, `remove`) are the same on both platforms. The difference is only in how you register handlers and how you connect the rewriter to the response.

### Fetch API

| Aspect | Cloudflare Workers | Fastly Compute |
|--------|-------------------|----------------|
| Origin fetch | `fetch(request)` — auto-routes to origin | `fetch(request, { backend: "origin" })` — requires explicit backend name |
| Cache control | `fetch(url, { cf: { cacheTtl: 120 } })` | `fetch(url, { backend: "origin", cacheOverride: new CacheOverride("override", { ttl: 120 }) })` |
| Request/Response | Standard Web APIs | Standard Web APIs — identical |

Fastly requires all outbound fetch calls to specify a named **backend**. Backends are declared in the `fastly.toml` configuration file:

```toml
# fastly.toml
[local_server.backends.origin]
url = "https://customer-origin.com"

[local_server.backends.optimizely-cdn]
url = "https://cdn.optimizely.com"
```

### Key-Value Storage

| Aspect | Cloudflare Workers KV | Fastly KV Store |
|--------|----------------------|-----------------|
| Access pattern | `await env.KV_NAMESPACE.get(key)` | `const store = new KVStore("name"); await store.get(key)` |
| Consistency | Eventually consistent | Eventually consistent |
| Max value size | 25 MB | 25 MB (up to 100 MB on request) |
| TTL support | Per-key expiration | Per-item TTL |

The SDK's KV usage (optional, for caching experiment config) translates directly.

### Entry Point

| Aspect | Cloudflare Workers | Fastly Compute |
|--------|-------------------|----------------|
| Module format | `export default { async fetch(request, env, ctx) {} }` | `addEventListener("fetch", (event) => event.respondWith(handleRequest(event)))` |
| Context | `ctx.waitUntil(promise)` | `event.waitUntil(promise)` |

### Platform Features Not Available on Fastly

| Cloudflare Feature | Used by SDK? | Impact |
|-------------------|-------------|--------|
| Durable Objects | No | None |
| Queues | No | None |
| D1 / Hyperdrive | No | None |
| Workers AI | No | None |
| R2 Storage | No | None |

None of the Cloudflare-specific platform features used by the SDK are blockers. The SDK only uses `HTMLRewriter`, `fetch()` with cache hints, and optionally KV — all of which have Fastly equivalents.

---

## 3. SDK Code — Cloudflare-Specific Touchpoints

We audited the SDK source code (`src/index.ts`, `src/data.ts`) and identified every Cloudflare-specific API call. The full list:

### `src/index.ts`

| Line(s) | Code | Cloudflare API | Fastly Equivalent | Change Required |
|---------|------|---------------|-------------------|-----------------|
| 166 | `return new Request(requestUrl, request)` | Standard Web API | Identical | None |
| 183-196 | `fetch(targetRequest, fetchOptions)` where `fetchOptions.cf = { cacheTtl }` | `cf.cacheTtl` cache hint | `CacheOverride` class | Update fetch options |
| 395-396 | `new HTMLRewriter()` | Cloudflare HTMLRewriter | `HTMLRewritingStream` | Use adapter |
| 399 | `relay.applyTransforms(rewriter, existingSnippet)` | Passes HTMLRewriter to relay | Passes adapter | Adapter handles it |
| 405-412 | `relay.applyBrowserJs(rewriter, ...)` | Passes HTMLRewriter to relay | Passes adapter | Adapter handles it |
| 424-431 | `rewriter.transform(new Response(control.body, ...))` | HTMLRewriter.transform() | `.pipeThrough()` | Adapter handles it |
| 490-497 | `snippetRewriter.on('head', new ScriptTagInjector(...))` then `snippetRewriter.transform(newControl)` | HTMLRewriter .on() + .transform() | Adapter handles it | Adapter handles it |
| 529 | `return fetch(targetRequest)` | Auto-routes to origin | Needs backend param | Add backend |
| 541-550 | `snippetRewriter.on('head', ...).transform(control)` | HTMLRewriter .on() + .transform() | Adapter handles it | Adapter handles it |
| 583-594 | `snippetRewriter.on('head', ...).transform(control)` | HTMLRewriter .on() + .transform() | Adapter handles it | Adapter handles it |

### `src/data.ts`

| Line(s) | Code | Cloudflare API | Fastly Equivalent | Change Required |
|---------|------|---------------|-------------------|-----------------|
| 37 | `fetch(configUrl, { cf: { cacheTtl: ttl } })` | `cf.cacheTtl` cache hint | `CacheOverride` + backend | Update fetch options, add backend for `cdn.optimizely.com` |

### `src/injectors.ts`

| Usage | Code | Cloudflare API | Fastly Equivalent | Change Required |
|-------|------|---------------|-------------------|-----------------|
| ScriptTagInjector | Implements HTMLRewriter element handler interface | `.element(el)` handler | `.onElement(selector, callback)` | Adapter handles it |

### `src/relay.ts`

| Usage | Cloudflare API | Fastly Equivalent | Change Required |
|-------|---------------|-------------------|-----------------|
| `applyTransforms(rewriter)` | Receives HTMLRewriter, calls `.on()` | Receives adapter | Adapter handles it |
| `applyBrowserJs(rewriter)` | Receives HTMLRewriter, calls `.on()` | Receives adapter | Adapter handles it |
| `getAdditionalHeaders()` | Returns Headers (standard API) | Identical | None |

### Summary

- **HTMLRewriter usage**: 6 locations in `index.ts`, plus `injectors.ts` and `relay.ts`
- **`cf` cache hints**: 2 locations (`index.ts` line 191, `data.ts` line 37)
- **`fetch()` without backend**: 3 locations (`index.ts` lines 196, 529; `data.ts` line 37)
- **Everything else**: Pure JavaScript — `cookie` parsing, URL manipulation, experiment logic, variation mapping — all platform-agnostic

---

## 4. Deep Audit — Every Platform Dependency

We audited every file in the SDK source (`src/`) to identify every Cloudflare-specific API call, type reference, and platform assumption. This is the complete list.

### 4.1 `src/index.ts` — Main entry point

**Cloudflare APIs used:**

| Line | Code | API | Adapter Needed |
|------|------|-----|----------------|
| 166 | `new Request(requestUrl, request)` | Standard Web API | No |
| 191 | `fetchOptions.cf = { cacheTtl: cacheTTL }` | `cf` object on fetch | Yes — translate to `CacheOverride` |
| 196 | `await fetch(targetRequest, fetchOptions)` | `fetch()` auto-routes to origin | Yes — add backend param |
| 312 | `applyExperiments(request, context, options)` | `context: ExecutionContext` | Yes — Fastly uses `FetchEvent` |
| 395-396 | `edgeOptions.rewriter \|\| new HTMLRewriter()` | `HTMLRewriter` constructor | Yes — use adapter |
| 424-431 | `rewriter.transform(new Response(control.body, ...))` | `HTMLRewriter.transform()` | Yes — adapter handles |
| 490-497 | `snippetRewriter.on('head', ...).transform(newControl)` | `.on()` + `.transform()` | Yes — adapter handles |
| 529 | `return fetch(targetRequest)` | `fetch()` without backend | Yes — add backend |
| 541-550 | `snippetRewriter.on('head', ...).transform(control)` | `.on()` + `.transform()` | Yes — adapter handles |
| 583-594 | `snippetRewriter.on('head', ...).transform(control)` | `.on()` + `.transform()` | Yes — adapter handles |

**Types referenced:**
- `ExecutionContext` (Cloudflare Workers type) — used in function signatures on lines 312, 214
- `HTMLRewriter` (Cloudflare Workers type) — used in function signatures on lines 430, 520

### 4.2 `src/relay.ts` — Experiment decision & DOM transforms (803 lines)

This is the largest file and the core of the SDK. The audit result is **very favorable** — it's almost entirely platform-agnostic.

**Cloudflare APIs used:**

| Line | Code | API | Adapter Needed |
|------|------|-----|----------------|
| 214 | `async decide(context: ExecutionContext)` | `ExecutionContext` type | Yes — change type to `FetchEvent` or generic |
| 429-500 | `applyTransforms(rewriter: HTMLRewriter)` | Receives HTMLRewriter, passes to `applyTransformations()` | Yes — type signature only, adapter handles |
| 496 | `return applyTransformations(rewriter, ...)` | Passes rewriter to external `@optimizely/client-experimentation` | **Critical** — external dependency also uses HTMLRewriter |
| 519-599 | `applyBrowserJs(rewriter: HTMLRewriter, ...)` | Receives HTMLRewriter | Yes — type signature |
| 591 | `rewriter.on(element, new ScriptTagInjector(...))` | `.on()` handler registration | Yes — adapter handles |
| 601-620 | `insertJquery(rewriter: HTMLRewriter, ...)` | Receives HTMLRewriter | Yes — type signature |
| 616 | `rewriter.on(element, new ScriptTagInjector(...))` | `.on()` handler registration | Yes — adapter handles |

**Critical finding — `applyTransformations()` on line 496:**
This calls into `@optimizely/client-experimentation` (external package, line 2):
```typescript
import { applyTransformations } from '@optimizely/client-experimentation/lib/cf/transformer';
```
Note the import path: `/lib/cf/transformer` — the **`cf`** in the path stands for **Cloudflare**. This external package has a Cloudflare-specific transformer that directly calls `rewriter.on(selector, handler)` using the Cloudflare HTMLRewriter API. This is the function that actually registers the DOM mutation handlers (attribute changes, text changes, element removals, etc.) for each experiment variation.

**This is the single most important dependency to verify.** The adapter must be compatible with however `applyTransformations()` calls `.on()`. If it uses standard `.on(selector, { element(el) {...} })` patterns (which is likely), the adapter works. If it uses any undocumented Cloudflare-specific behavior, we have a gap.

**Everything else in relay.ts is pure JavaScript:**
- `decide()` — experiment bucketing, audience evaluation, variation assignment (lines 214-411)
- `getChangesFromVariation()` — extracts DOM changes from variation data (lines 413-427)
- `loadStickyData()` / `saveStickyData()` — cookie-based persistence (lines 154-212)
- `validateVisitorId()` — visitor ID management (lines 91-130)
- `getAdditionalHeaders()` — standard `Headers` API (lines 132-141)
- `computeBrowserJS()` — generates client-side JS string (lines 628-672)
- `updateInputsWithOriginCookies()` — cookie parsing (lines 711-741)
- `addOptimizelyCSPRequirements()` — CSP header manipulation (lines 747-802)
- `removeSnippetChange()` — generates change objects (lines 674-709)

### 4.3 `src/injectors.ts` — ScriptTagInjector (45 lines)

```typescript
export class ScriptTagInjector implements HTMLRewriterElementContentHandlers {
    element(element: Element) {
        injectFn.call(element, `<script ...>...</script>`, { html: true });
    }
}
```

**Cloudflare APIs used:**
- `HTMLRewriterElementContentHandlers` interface (line 1) — TypeScript type only
- `Element` type in handler (line 24) — Cloudflare's element type
- `element.prepend()`, `element.append()`, `element.after()` with `{ html: true }` option (lines 31-43)

**Adapter requirement:** The adapter must ensure that element methods (`prepend`, `append`, `after`) accept an `{ html: true }` options argument. Fastly's `HTMLRewritingStream` element methods do support this option — verified in Fastly docs.

### 4.4 `src/data.ts` — Config fetching (72 lines)

**Cloudflare APIs used:**

| Line | Code | API | Adapter Needed |
|------|------|-----|----------------|
| 37 | `fetch(configUrl, { cf: { cacheTtl: ttl } })` | `cf` cache hint on fetch | Yes — use `CacheOverride` + backend |

**Additional note:** Line 6 uses `const dataMap = new Map()` as a module-level in-memory cache. This works on both platforms — Fastly Compute also keeps module-level state across requests within the same isolate.

### 4.5 `src/utils.ts` — Utilities (93 lines)

**Cloudflare APIs used:**

| Line | Code | API | Adapter Needed |
|------|------|-----|----------------|
| 13 | `crypto.subtle.digest({ name: 'SHA-256' }, ...)` | Web Crypto API | No — standard API, available on Fastly |
| 43 | `await caches.open('custom:cache')` | Cache API | **Yes** — Fastly uses different cache APIs |
| 44 | `await myCache.match(getCacheKeyUrl(key))` | Cache API `.match()` | **Yes** — translate to Fastly Simple Cache or Core Cache |
| 60 | `await caches.open('custom:cache')` | Cache API | **Yes** |
| 71 | `await myCache.put(url, response)` | Cache API `.put()` | **Yes** |

**This is a previously unidentified dependency.** The `getCachedString()` and `saveCachedString()` functions use Cloudflare's Web Cache API (`caches.open()`, `cache.match()`, `cache.put()`) to cache the generated browser JS. This is used when `browserTTL` is set in the options.

Fastly equivalent — use the **Simple Cache API**:
```javascript
import { SimpleCache } from "fastly:cache";

// Read
const entry = SimpleCache.get(key);
const value = entry ? await entry.text() : undefined;

// Write
SimpleCache.set(key, content, ttl);
```

### 4.6 `src/track.ts` — Event tracking (210 lines)

**Cloudflare APIs used:**

| Line | Code | API | Adapter Needed |
|------|------|-----|----------------|
| 7 | `const CLIENT_NAME = 'ed-cf'` | Hardcoded client name | Yes — change to `'ed-fastly'` or make configurable |
| 13 | `context: ExecutionContext` | Cloudflare type | Yes — use Fastly `FetchEvent` |
| 188 | `context.waitUntil(fetch(...))` | `ExecutionContext.waitUntil()` | Yes — Fastly uses `event.waitUntil()` (same concept, different type) |
| 189 | `fetch(TRACKING_HOST, { method: 'POST', ... })` | `fetch()` without backend | Yes — add backend for `logx.optimizely.com` |

### 4.7 `src/models.ts` — Type definitions (531 lines)

**Cloudflare APIs used:**

| Line | Code | API | Adapter Needed |
|------|------|-----|----------------|
| 431 | `kvNamespace?: KVNamespace` | Cloudflare KV type | Yes — change to Fastly `KVStore` or generic |
| 436 | `rewriter?: HTMLRewriter` | Cloudflare type | Yes — change to adapter type |

These are TypeScript type annotations only — no runtime behavior.

### 4.8 `src/sticky.ts` — Sticky bucketing (163 lines)

**Cloudflare APIs used:** None. Pure JavaScript — cookie parsing and string manipulation.

### 4.9 `src/browserDefines.ts` — Browser JS generation

**Cloudflare APIs used:** None. Pure JavaScript — generates JS strings for browser-side execution.

### 4.10 `src/visitor_id.ts` — Visitor identification

**Cloudflare APIs used:** None. Pure JavaScript — cookie-based visitor ID management.

### 4.11 `src/webhook.ts` — Webhook handling

**Cloudflare APIs used:** Standard `Request`/`Response` and `crypto.subtle` (Web Crypto API). Both available on Fastly.

### 4.12 `src/edge-decider/` — Experiment decision engine (entire directory)

**Cloudflare APIs used:** None. This entire directory is pure JavaScript — bucketing algorithms (MurmurHash), audience evaluation, view matching, targeting conditions, device detection, cookie utilities. Zero platform dependencies.

---

## Summary: Complete Dependency Map

### Platform-specific (requires changes)

| Dependency | Files | Occurrences | Fastly Equivalent | Effort |
|-----------|-------|-------------|-------------------|--------|
| `HTMLRewriter` class | `index.ts`, `relay.ts`, `injectors.ts`, `models.ts` | 8 constructor/type uses, 6 `.on()` calls, 4 `.transform()` calls | `HTMLRewritingStream` via adapter | Medium |
| `applyTransformations()` from `@optimizely/client-experimentation/lib/cf/transformer` | `relay.ts` line 496 | 1 call | **Must verify** — external package, Cloudflare-specific path | **High risk** |
| `fetch()` with `{ cf: { cacheTtl } }` | `index.ts`, `data.ts` | 2 calls | `CacheOverride` class | Low |
| `fetch()` without backend | `index.ts`, `data.ts`, `track.ts` | 4 calls | Add backend param | Low |
| `ExecutionContext` type | `index.ts`, `relay.ts`, `track.ts` | 3 type references | `FetchEvent` | Low |
| `context.waitUntil()` | `track.ts` | 1 call | `event.waitUntil()` | Trivial |
| `caches.open()` / `cache.match()` / `cache.put()` | `utils.ts` | 4 calls | Fastly `SimpleCache` | Low |
| `KVNamespace` type | `models.ts` | 1 type reference | `KVStore` | Trivial |
| `CLIENT_NAME = 'ed-cf'` | `track.ts` | 1 constant | Change to `'ed-fastly'` | Trivial |
| `HTMLRewriterElementContentHandlers` interface | `injectors.ts` | 1 type reference | Define locally or use adapter type | Trivial |

### Platform-agnostic (no changes needed)

| Module | Lines | Dependencies |
|--------|-------|-------------|
| `src/relay.ts` (business logic) | ~700 of 803 | Pure JS |
| `src/edge-decider/` (entire directory) | ~2000+ | Pure JS |
| `src/sticky.ts` | 163 | Pure JS |
| `src/browserDefines.ts` | All | Pure JS |
| `src/visitor_id.ts` | All | Pure JS |
| `src/models.ts` (data classes) | ~520 of 531 | Pure JS |
| `src/webhook.ts` | All | Standard Web APIs |
| `src/enums.ts` | All | Pure JS |

---

## Previously Flagged Risk: `@optimizely/client-experimentation` — RESOLVED

The highest-risk item was the external dependency on line 2 of `relay.ts`:

```typescript
import { applyTransformations } from '@optimizely/client-experimentation/lib/cf/transformer';
```

**We obtained and audited this package.** The risk is **eliminated**. Here's exactly what the transformer does:

### `transformer.js` — Entry point

```javascript
function applyTransformations(rewriter, transformations) {
    for (const [flags, selector, op, ...rest] of transformations) {
        if (flags & Experimentation.Flags.PreUA) {
            rewriter.on(selector, new PreUATransformApplicator(op, ...rest));
        }
    }
    if (clientTransformCount) {
        rewriter.on('head', new UATransformApplicator(transformations));
    }
    return rewriter;
}
```

Uses **only** `rewriter.on(selector, handler)` — the standard pattern our adapter handles.

### `pre-ua-applicator.js` — Server-side DOM changes

Maps Optimizely experiment operations to HTMLRewriter element methods:

```javascript
const experimentationOpToCFOpMap = {
    InsertBefore:  ['before',           (html) => [html, { html: true }]],
    InsertAfter:   ['after',            (html) => [html, { html: true }]],
    Prepend:       ['prepend',          (html) => [html, { html: true }]],
    Append:        ['append',           (html) => [html, { html: true }]],
    Replace:       ['replace',          (html) => [html, { html: true }]],
    SetInnerHtml:  ['setInnerContent',  (html) => [html, { html: true }]],
    Remove:        ['remove',           () => []],
    SetAttribute:  ['setAttribute',     (name, value) => [name, value]],
};

element(element) {
    const [method, fnArgTranslator] = experimentationOpToCFOpMap[this.op];
    element[method].call(element, ...fnArgTranslator(...this.args));
}
```

Every method used (`before`, `after`, `prepend`, `append`, `replace`, `setInnerContent`, `remove`, `setAttribute`) is available on Fastly's `HTMLRewritingStream` with identical signatures including the `{ html: true }` option.

### `on-ua-applicator.js` — Client-side deferred transforms

For operations that can't run on the edge (CustomJS, redirects), it serializes them into a `<script>` tag and injects via `element.append(script, { html: true })` on `<head>`. Standard method, adapter-compatible.

### Verdict

**The `cf` in the import path is misleading.** Despite the path name, the transformer uses no Cloudflare-specific APIs. It only uses:
- `rewriter.on(selector, { element(el) {...} })` — standard handler registration
- `element.before/after/prepend/append/replace/setInnerContent/remove/setAttribute` with `{ html: true }` — standard element methods

**All of these are supported by Fastly's `HTMLRewritingStream` and handled by our adapter. No Fastly-specific transformer is needed.**

---

## 5. Implementation Approach

### Recommended: Adapter Layer

Write a thin compatibility wrapper that gives Fastly's `HTMLRewritingStream` the same API as Cloudflare's `HTMLRewriter`. This minimizes changes to the core SDK.

```javascript
import { HTMLRewritingStream } from "fastly:html-rewriter";

/**
 * HTMLRewriter adapter — provides Cloudflare's HTMLRewriter API
 * on top of Fastly's HTMLRewritingStream.
 */
class HTMLRewriter {
    constructor() {
        this._stream = new HTMLRewritingStream();
    }

    on(selector, handlers) {
        if (handlers.element) {
            this._stream.onElement(selector, handlers.element);
        }
        if (handlers.text) {
            this._stream.onText(selector, handlers.text);
        }
        if (handlers.comments) {
            this._stream.onComments(selector, handlers.comments);
        }
        return this;
    }

    onDocument(handlers) {
        if (handlers.doctype) {
            this._stream.onDoctype(handlers.doctype);
        }
        if (handlers.end) {
            this._stream.onEnd(handlers.end);
        }
        return this;
    }

    transform(response) {
        const transformedBody = response.body.pipeThrough(this._stream);
        return new Response(transformedBody, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    }
}

export { HTMLRewriter };
```

This adapter lets the existing SDK code (`relay.applyTransforms(rewriter)`, `rewriter.on('head', handler)`, `rewriter.transform(response)`) work without modification.

### Fetch Wrapper

Create a platform-aware fetch function that adds backend declarations:

```javascript
const BACKENDS = {
    origin: "origin",                    // Customer's origin server
    optimizely: "optimizely-cdn",        // cdn.optimizely.com
};

function detectBackend(url) {
    if (url.includes("cdn.optimizely.com")) return BACKENDS.optimizely;
    if (url.includes("optimizely-staging")) return BACKENDS.optimizely;
    return BACKENDS.origin;
}

async function edgeFetch(request, options = {}) {
    const url = typeof request === "string" ? request : request.url;
    const backend = detectBackend(url);

    const fetchOptions = { ...options, backend };

    // Translate cf.cacheTtl to Fastly CacheOverride
    if (options.cf && typeof options.cf.cacheTtl !== "undefined") {
        const { CacheOverride } = await import("fastly:cache-override");
        fetchOptions.cacheOverride = new CacheOverride("override", {
            ttl: options.cf.cacheTtl,
        });
        delete fetchOptions.cf;
    }

    return fetch(request, fetchOptions);
}

export { edgeFetch };
```

### Fastly Service Configuration

```toml
# fastly.toml

name = "optimizely-edge-delivery"
language = "javascript"

[local_server]

[local_server.backends]

[local_server.backends.origin]
url = "https://customer-origin.com"

[local_server.backends.optimizely-cdn]
url = "https://cdn.optimizely.com"

[setup.backends]

[setup.backends.origin]
address = "customer-origin.com"
port = 443

[setup.backends.optimizely-cdn]
address = "cdn.optimizely.com"
port = 443
```

### Entry Point

```javascript
import { applyExperiments } from "./index.js";

addEventListener("fetch", (event) => {
    event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
    return applyExperiments(event.request, event, {
        snippetId: "6023525610291200",
        isProd: true,
        // ... other options
    });
}
```

---

## 6. What Does NOT Need to Change

The following SDK modules are pure JavaScript and work on Fastly without any modification:

| Module | Purpose | Platform Dependencies |
|--------|---------|----------------------|
| `src/relay.ts` | Experiment decisions, variation mapping, transforms | None — pure JS |
| `src/edge-decider/` | Experiment bucketing, targeting, audience evaluation | None — pure JS |
| `src/models.ts` | TypeScript interfaces and types | None |
| `src/enums.ts` | Constants and enums | None |
| `src/utils.ts` | Utility functions (nonce extraction, etc.) | None |
| `src/visitor_id.ts` | Visitor ID generation and management | None |
| `src/track.ts` | Event tracking | None |
| `src/sticky.ts` | Sticky bucketing | None |
| `src/webhook.ts` | Webhook handling | None |
| `src/injectors.ts` | ScriptTagInjector (HTMLRewriter handler) | Works with adapter |
| Cookie handling | `cookie` npm package | Standard — works everywhere |

This is the majority of the codebase. The experiment logic — which is the hard part — is entirely platform-agnostic.

---

## 7. Alternative Approach: WASM HTMLRewriter

If the adapter approach doesn't cover edge cases in the HTMLRewriter API, there is a fallback option.

Cloudflare publishes an official WASM build of lol-html as an npm package: [`html-rewriter-wasm`](https://www.npmjs.com/package/html-rewriter-wasm). This provides the exact `HTMLRewriter` class API and can run in any JavaScript environment, including Fastly Compute.

```javascript
import { HTMLRewriter } from "html-rewriter-wasm";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let output = "";

const rewriter = new HTMLRewriter((outputChunk) => {
    output += decoder.decode(outputChunk);
});

rewriter.on("h1", {
    element(el) { el.setInnerContent("Modified"); }
});

await rewriter.write(encoder.encode(htmlBody));
await rewriter.end();
rewriter.free(); // Must free WASM memory
```

Tradeoffs:

| Aspect | Native Adapter (recommended) | WASM HTMLRewriter (fallback) |
|--------|-----------------------------|-----------------------------|
| Performance | Native speed — compiled into Fastly runtime | WASM overhead + Asyncify |
| API fidelity | Adapter may miss edge cases | Exact Cloudflare API |
| Memory | Automatic — managed by runtime | Manual — must call `.free()` |
| Streaming | Full streaming via `pipeThrough()` | Sequential writes only |
| Dependencies | Zero — uses built-in Fastly API | ~500KB WASM binary |
| Maintenance | Must keep adapter in sync with API changes | Maintained by Cloudflare |

**Recommendation**: Start with the native adapter. It covers all the patterns used in the SDK (element handlers, text handlers, `transform(response)`). Fall back to the WASM package only if you discover API gaps.

There is also a community package [`@worker-tools/html-rewriter`](https://www.npmjs.com/package/@worker-tools/html-rewriter) that wraps the WASM build with a cleaner API and works across Deno, browsers, Node.js, and other worker runtimes.

---

## 8. Effort Estimate

| Task | Description | Scope | Risk |
|------|-------------|-------|------|
| HTMLRewriter adapter | Wrap `HTMLRewritingStream` with Cloudflare-compatible API | ~100 lines | Low |
| Fetch wrapper | Add backend declarations, translate `cf.cacheTtl` to `CacheOverride` | ~30 lines | Low |
| Cache wrapper | Translate `caches.open()`/`.match()`/`.put()` in `utils.ts` to Fastly `SimpleCache` | ~20 lines | Low |
| Entry point | Fastly `addEventListener("fetch", ...)` wrapper | ~20 lines | Low |
| `fastly.toml` config | Backend declarations for origin + Optimizely CDN + logx.optimizely.com | ~30 lines | Low |
| SDK modifications | Replace imports, type signatures, fetch calls across `index.ts`, `data.ts`, `track.ts`, `utils.ts`, `models.ts` | ~25 line changes across 5 files | Low |
| `@optimizely/client-experimentation` audit | **COMPLETED** — uses only standard `.on()` + element methods. Adapter-compatible. | None — verified | **Resolved** |
| Testing | Validate all experiment types (element changes, script injection, snippet fallback, cookie handling, event tracking) | Functional test suite | Medium |
| 304 fix (Layer B) | Same fix applies — strip conditional headers in `getTargetRequest()` | Already written | None |

**Total new code**: ~200 lines + configuration
**Total SDK modifications**: ~25 line changes across 5 files
**Core experiment logic changes**: Zero
**Previously blocking risk**: `@optimizely/client-experimentation/lib/cf/transformer` — **RESOLVED**. Audited and confirmed adapter-compatible. No blockers remain.

---

## 9. Risks and Considerations

### Low Risk (confirmed via audit)

- **Element handler API compatibility**: Verified in `injectors.ts` — uses `element.prepend()`, `element.append()`, `element.after()` with `{ html: true }`. Fastly's `HTMLRewritingStream` supports all three methods with the `{ html: true }` option. Adapter is straightforward.
- **Cookie handling**: `cookie` npm package (pure JS) used throughout. No platform dependencies.
- **Experiment logic**: Entire `edge-decider/` directory, `sticky.ts`, `browserDefines.ts`, `visitor_id.ts` — all pure JavaScript. Confirmed zero platform APIs.
- **Web Crypto API**: `crypto.subtle.digest()` in `utils.ts` — standard Web Crypto API, available on Fastly Compute.
- **`ScriptTagInjector`**: Audited in `injectors.ts` — implements `{ element(el) {...} }` handler pattern with standard element methods. Adapter-compatible.
- **`relay.applyBrowserJs()`**: Audited — calls `rewriter.on(element, new ScriptTagInjector(...))` using standard `.on()` pattern. Adapter-compatible.

### Medium Risk (confirmed via audit)

- **Cache API in `utils.ts`**: Uses `caches.open('custom:cache')`, `cache.match()`, `cache.put()` — Cloudflare's Web Cache API. This was **not identified in the initial assessment**. Requires translation to Fastly's `SimpleCache` API. Used for caching generated browser JS when `browserTTL` is set. ~20 lines to translate.
- **Event tracking backend**: `track.ts` calls `fetch(TRACKING_HOST, ...)` to `logx.optimizely.com` without a backend param. Needs a third backend declaration in `fastly.toml`.
- **`ExecutionContext` vs `FetchEvent`**: Used in 3 files (`index.ts`, `relay.ts`, `track.ts`). Fastly uses `FetchEvent` with the same `.waitUntil()` method. Type change only — no behavioral difference.
- **Edge location coverage**: Cloudflare has 330+ PoPs vs Fastly's 70+. Geographic coverage may differ for latency-sensitive deployments.

### High Risk — NONE REMAINING

- **`@optimizely/client-experimentation/lib/cf/transformer`**: Originally flagged as highest risk. **Audited and resolved.** Despite the `/lib/cf/` path name, the transformer uses only standard `.on(selector, { element(el) {...} })` handler registration and standard element methods (`before`, `after`, `prepend`, `append`, `replace`, `setInnerContent`, `remove`, `setAttribute`) — all with `{ html: true }` options. Every one of these is supported by Fastly's `HTMLRewritingStream`. The adapter handles this with zero modifications to the transformer package.

### Verified — Not a Risk

- **`onDocument()` handlers**: The SDK does not use `.onDocument()` anywhere. No risk.
- **Response body consumption**: All `rewriter.transform()` calls pass a freshly constructed `Response` with an unconsumed body. No risk.
- **Streaming behavior**: The SDK returns the result of `.transform()` directly — never reads the body after transformation. No risk.

---

## 10. Recommended Next Steps

1. **Audit `relay.ts` fully** — Confirm all HTMLRewriter handler patterns used by `applyTransforms()` and `applyBrowserJs()` are covered by the adapter
2. **Build the adapter** — ~100 lines, can be validated independently with unit tests
3. **Build the fetch wrapper** — ~30 lines, straightforward backend routing
4. **Create a Fastly Compute test service** — Deploy with a test customer page, validate end-to-end
5. **Run the validation kit** — Use the same Edge Delivery Validation Kit (probe, Phase 1, Phase 2) against the Fastly-hosted worker to confirm parity with Cloudflare

---

## Appendix A: Fastly HTMLRewritingStream API Reference

```javascript
import { HTMLRewritingStream } from "fastly:html-rewriter";

const stream = new HTMLRewritingStream();

// Element handlers (equivalent to Cloudflare's .on(selector, { element(el) {} }))
stream.onElement("div.content", (element) => {
    element.getAttribute("class");           // Get attribute
    element.setAttribute("class", "new");    // Set attribute
    element.removeAttribute("class");        // Remove attribute
    element.hasAttribute("class");           // Check attribute
    element.prepend("<p>Before</p>");        // Insert before first child
    element.append("<p>After</p>");          // Insert after last child
    element.setInnerContent("New content");  // Replace children
    element.before("<div>Before element</div>");  // Insert before element
    element.after("<div>After element</div>");    // Insert after element
    element.remove();                        // Remove element
    element.removeAndKeepContent();          // Remove tag, keep children
    element.tagName;                         // Get/set tag name
});

// Text handlers
stream.onText("p", (textChunk) => {
    textChunk.text;          // The text content
    textChunk.lastInTextNode; // Boolean — is this the last chunk?
    textChunk.before("prefix");
    textChunk.after("suffix");
    textChunk.replace("new text");
    textChunk.remove();
});

// Comment handlers
stream.onComments("*", (comment) => {
    comment.text;            // Comment content
    comment.before("...");
    comment.after("...");
    comment.replace("...");
    comment.remove();
});

// Document-level handlers
stream.onDoctype((doctype) => { /* doctype.name, doctype.publicId, doctype.systemId */ });
stream.onEnd((end) => { end.append("<!-- end -->"); });

// Usage — pipe response body through the transformer
const transformed = response.body.pipeThrough(stream);
return new Response(transformed, response);
```

## Appendix B: Complete File List — What Changes vs What Doesn't

### Files that need changes (3 files)

| File | Change |
|------|--------|
| `src/index.ts` | Import adapter instead of native HTMLRewriter, use fetch wrapper for origin fetches |
| `src/data.ts` | Use fetch wrapper for CDN fetches (adds backend + CacheOverride) |
| Entry point (new) | Fastly-specific `addEventListener("fetch", ...)` wrapper |

### New files (3 files)

| File | Purpose |
|------|---------|
| `src/platform/fastly-rewriter.ts` | HTMLRewriter adapter wrapping HTMLRewritingStream |
| `src/platform/fastly-fetch.ts` | Fetch wrapper with backend routing and cache translation |
| `fastly.toml` | Service configuration with backend declarations |

### Files that don't change (11 files)

| File | Why |
|------|-----|
| `src/relay.ts` | Pure JS — experiment logic, transforms, cookie handling |
| `src/edge-decider/*` | Pure JS — bucketing, targeting, audience evaluation |
| `src/models.ts` | TypeScript types |
| `src/enums.ts` | Constants |
| `src/utils.ts` | Utilities |
| `src/visitor_id.ts` | Visitor ID management |
| `src/track.ts` | Event tracking |
| `src/sticky.ts` | Sticky bucketing |
| `src/webhook.ts` | Webhook handling |
| `src/injectors.ts` | ScriptTagInjector — works with adapter |
| `src/browserDefines.ts` | Browser-side JS generation |

---

*Prepared by the Edge Delivery Engineering Team*
*Report Reference: FASTLY-FEASIBILITY-20260320*
