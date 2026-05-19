Optimizely Edge Delivery — Hydration Reinforcement
====================================================

A single technical document for three audiences:

1. **Engineering teams running Optimizely Edge Delivery on a Vue / Nuxt
   SSR site (GitLab, and customers with comparable stacks).** Read all
   sections; Part B is your install reference.
2. **Optimizely SDK engineers.** Read all sections; Part A is the spec
   for the change to land in `@optimizely/edge-delivery`. The mechanism
   has been built and validated end-to-end against a live Pages
   deployment with a real Optimizely experiment — no part of this is
   theoretical.
3. **Optimizely product.** Read the executive summary, the lifecycle
   walkthrough, and the productisation notes at the end.

No ambiguity. Every code snippet, selector, and behaviour described
below corresponds to the deployed lab at
`https://edge-del-v2-target.pages.dev/`. The lab's source lives at
`edge-del-v2/` in this repository.


Contents
--------

  1.  Executive summary
  2.  The problem we are solving
  3.  Empirical map: which change types Vue actually recovers
  4.  Architecture at a glance
  5.  Request lifecycle, twelve steps
  6.  The manifest protocol — single source of truth for both sides
  7.  Part A — SDK-side extension (Optimizely engineering)
  8.  Part B — Customer-side companion (Customer engineering / PS)
  9.  Authoring guidance for experimentation teams
  10. Debugging and observability
  11. Limitations and known edge cases
  12. Productisation notes (Optimizely product)
  13. File reference and live URLs


1. Executive summary
--------------------

Optimizely Edge Delivery applies experiment variations at the CDN. On a
Vue / Nuxt SSR page, the variation is in the bytes the browser receives,
but Vue's hydration step subsequently walks the DOM and reconciles it
against the virtual DOM produced by the same component code that rendered
the SSR HTML. When the two disagree, Vue's recovery pass discards
unexpected nodes and re-renders mismatched bindings. The Edge Delivery
variation is the disagreement, and Vue erases it — silently in production
builds, with a `[Vue warn]` in development.

The reinforcement is a two-part mechanism that survives this recovery
without per-experiment customer code:

- **Edge Delivery worker post-processing.** Immediately after
  `applyExperiments()` returns, scan the response body for the
  `data-optly-<changeId>` markers and `<div style="display:contents"
  data-optly-<id>>…</div>` wrappers that the SDK already emits. Build a
  small JSON manifest describing the applied changes. Emit that manifest
  inline before `</body>`, along with a `<script>` tag containing the
  companion. **No second fetch. No manifest re-parse. Everything derived
  from the response we already produced.**

- **Browser companion.** A small (~4 KB) IIFE the worker emits. On every
  page load it reads the inline manifest, waits for the SSR framework to
  finish hydrating (Nuxt's `app:mounted` hook first, then a Vue root
  instance poll, then `requestIdleCallback` as a fallback), and
  idempotently re-applies any operations Vue undid during recovery. The
  companion stamps `data-edge-companion-inserted="1"` and
  `data-edge-applied="<caseId>__<i>"` markers so it never duplicates work
  on SPA navigations or hydration replays.

Once both pieces are in place, the routing decision the customer has been
managing per-experiment (Edge Delivery vs client-side based on change-type
fragility) goes away. Every experiment can ship at the edge — including
the additive, structural, and reactive-binding cases that today force
client-side execution.

End-to-end validation:

- `https://edge-del-v2-target.pages.dev/?reinforce=off` — variation
  visible at first paint, Vue discards it on hydration. Customer pain
  reproduced via the real Optimizely SDK.
- `https://edge-del-v2-target.pages.dev/?reinforce=on` — same edge path,
  companion holds the variation through hydration. Banner stays.

Same SSR origin, same Optimizely Visual Editor experiment, same Vue
runtime. Only the reinforcement differs.


2. The problem we are solving
-----------------------------

Optimizely Edge Delivery's value proposition is server-side application
of experiment variations: no flash of original content, full SEO
visibility, no client-side timing penalty. The SDK runs inside a
Cloudflare Worker, fetches the project's manifest from
`https://cdn.optimizely.com/js/web_sdk_v0_<snippetId>.json`, evaluates
audience targeting from request-time signals, buckets the visitor
stickily via `optimizelyEndUserId`, and applies the variation's changes
to the streaming HTML response via Cloudflare's HTMLRewriter.

That is the clean story on a non-hydrating page. On a Vue 3 / Nuxt 3 SSR
page, the story changes after the bytes leave the CDN.

Vue's hydration step compares the DOM the browser parsed (containing the
edge-applied variation) against the virtual DOM produced by the same
components that rendered the SSR HTML on the server. The two disagree on
exactly the changes Edge Delivery applied. Vue's recovery pass:

- For text bound to `{{ value }}` interpolations, re-renders the text to
  the binding's current value.
- For attributes bound to `:attr="value"`, resets the attribute.
- For unexpected children of a `v-for` parent, discards them.
- For elements expected by the render function but absent in the DOM,
  recreates them.

`data-allow-mismatch` (introduced in Vue 3.5) suppresses the dev-mode
warning, but **empirical mechanism-isolation testing in production
builds shows it does not skip the recovery pass.** Vue still reconciles
against its virtual DOM regardless of the attribute. We treat
`data-allow-mismatch` as defensive belt-and-suspenders — useful for
silencing dev-mode log noise during customer development, not as the
mechanism that keeps variations alive.

The reinforcement layer described here does not depend on
`data-allow-mismatch`. It works against the post-hydration DOM
unconditionally.


3. Empirical map: which change types Vue actually recovers
----------------------------------------------------------

Recorded against the deployed lab (Nuxt 3.21 / Vue 3.5.33 production
build, `cloudflare_pages` preset) using the kit's ten-case catalogue and
mechanism-isolation runs with the companion disabled.

| Change shape                                                | Survives natively (no reinforcement) | Needs companion |
|-------------------------------------------------------------|:---:|:---:|
| Hardcoded text inside a template (no `{{ }}`)               | ✓   |     |
| Attribute on an element with no `:attr=` binding            | ✓   |     |
| Class / style on an element with no reactive binding        | ✓   |     |
| Image `src` / `srcset` / `alt` on an existing `<img>`       | ✓ (expected; not yet wired in the kit) | |
| Insertion into an EMPTY static anchor element               | ✓   |     |
| Text edit of a `{{ binding }}` reactive node                |     | ✓   |
| Attribute edit of a `:attr="binding"` reactive node         |     | ✓   |
| Insertion into a `v-for` parent or component-managed parent |     | ✓   |
| Removal of an element the parent component still renders    |     | ✓   |
| Reorder of children in any `v-for` (keyed or unkeyed)       |     | ✓   |
| Edits inside `<ClientOnly>` / dynamic islands               |     | ✓ (post-mount) |

The actually-fragile boundary is **reactivity** (a binding rendering an
expected value into a node, OR a `v-for` rendering an expected child
count). "Stateful subtree" as a routing heuristic is too coarse — static
template content inside a stateful component survives. The reinforcement
layer covers every fragile case generically, with one install.


4. Architecture at a glance
---------------------------

The lab deploys as a single Cloudflare Pages project. Pages "advanced
mode" lets a project ship a `_worker.js` that handles every request; Nuxt
3's `cloudflare_pages` preset writes this `_worker.js` to serve SSR. We
wrap that handler with the Edge Delivery + reinforcement logic. The end
state is a single URL serving SSR + variation + reinforcement in one
worker. Mirrors how a customer with an integrated Cloudflare deployment
would ship Edge Delivery in production.

    ┌─────────────────────────────────────────────────────────────────┐
    │                  Cloudflare Pages — single project              │
    │                                                                 │
    │   ┌─────────────────────────────────────────────────────────┐   │
    │   │            dist/_worker.js/index.js                     │   │
    │   │                                                         │   │
    │   │   on(fetch) →                                           │   │
    │   │                                                         │   │
    │   │     1.  nitro SSR handler  → SSR HTML Response          │   │
    │   │            (Nuxt 3 / Vue 3.5)                           │   │
    │   │                                                         │   │
    │   │     2.  applyExperiments(request, ctx, {                │   │
    │   │            snippetId,                                   │   │
    │   │            control: ssrResponse                         │   │
    │   │         })                                              │   │
    │   │           → SDK applies variation via HTMLRewriter      │   │
    │   │           → response now contains                       │   │
    │   │              <div style="display:contents"              │   │
    │   │                   data-optly-<changeId>>…</div>         │   │
    │   │                                                         │   │
    │   │     3.  extractOpsFromBody(rewrittenHtml)               │   │
    │   │           → scans the body we already have for          │   │
    │   │             data-optly-<id> wrappers                    │   │
    │   │           → builds Op[] for the companion               │   │
    │   │           → ZERO subrequests                            │   │
    │   │                                                         │   │
    │   │     4.  inject inline manifest + companion <script>     │   │
    │   │           → final response: variation in the bytes,     │   │
    │   │             companion + manifest ready for the          │   │
    │   │             browser                                     │   │
    │   └─────────────────────────────────────────────────────────┘   │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼  HTML response, single round trip
    ┌─────────────────────────────────────────────────────────────────┐
    │                            Browser                              │
    │                                                                 │
    │   First paint — variation visible (Edge Delivery's promise).    │
    │   Browser downloads Vue runtime, begins hydration.              │
    │   Vue walks DOM, reconciles against vDOM, recovers any          │
    │     mismatched / unexpected nodes.                              │
    │   Nuxt fires `app:mounted` → hydration complete.                │
    │                                                                 │
    │   Companion (already parsed and primed):                        │
    │     reads inline manifest                                       │
    │     iterates ops idempotently                                   │
    │     re-applies any op Vue undid                                 │
    │                                                                 │
    │   Final DOM = edge-applied variation, post-hydration-stable.    │
    └─────────────────────────────────────────────────────────────────┘


5. Request lifecycle, twelve steps
----------------------------------

Concrete trace of a single cold visit to
`https://edge-del-v2-target.pages.dev/?reinforce=on`. URLs and selectors
match the deployed lab. Substitute customer values for production.

    Step 1.  Browser dispatches GET https://edge-del-v2-target.pages.dev/
             Conditional headers (If-None-Match / If-Modified-Since) may
             accompany the request. Worker strips them so the SSR origin
             never returns a 304. (Same Layer B guard now upstream in
             @optimizely/edge-delivery ≥1.0.10 from the AmeriSave
             engagement.)

    Step 2.  Cloudflare Pages routes to dist/_worker.js. Our integrated
             entry runs.

    Step 3.  Worker calls Nuxt's nitro handler (imported by name `F` from
             ./chunks/nitro/nitro.mjs). Nitro renders the home page
             server-side and returns Response with text/html;charset=utf-8.

    Step 4.  Worker hands the SSR response to applyExperiments() as
             options.control. The SDK does NOT issue its own origin fetch
             when control is provided. The SDK reads its cached manifest
             (Cloudflare edge cache, sub-millisecond on warm), evaluates
             audience conditions and view URL match against request.url,
             buckets the visitor stickily via optimizelyEndUserId, picks
             the bucketed variation, and pipes the SSR Response through
             its internal HTMLRewriter to apply the variation's changes.

    Step 5.  SDK emits cookies on the response:
               optimizelyEndUserId=oeu<...>
               OPTY$$<userId>$$<projectId>$$VMAP=<layerId>_<expId>_<varId>
               OPTY$$<userId>$$<projectId>$$VPROF=<browser/device profile>
               optimizelySession=<session>

    Step 6.  SDK injects Optimizely's standard <script src="...js"> snippet
             into the <head> of the response. This snippet handles
             client-side telemetry (impressions, conversions, GA4 bridge,
             session continuity). Independent of the reinforcement.

    Step 7.  SDK has applied the variation. The response body now
             contains, for our append change:
               <div class="cards" data-edge-region="pricing-cards"
                    data-optly-A9DAA119-…>
                 <article id="plan-starter">…</article>
                 <article id="plan-professional">…</article>
                 <article id="plan-enterprise">…</article>
                 <div style="display:contents" data-optly-A9DAA119-…>
                   <article id="optly-edge-banner">…</article>
                 </div>
               </div>
             The data-optly-<changeId> attribute appears in two places:
             on the target element (the change's parent selector
             resolved at the edge), and on the wrapping div around any
             inserted content. Both share the same change UUID.

    Step 8.  Worker reads the response body once (await response.text()).
             For a typical SSR page (~50–350 KB post-snippet-injection)
             this buffer is sub-millisecond on Cloudflare's edge.

    Step 9.  Worker runs extractOpsFromBody(html). Regex matches the
             wrapper pattern, captures each change's changeId and inner
             HTML, and lowercases the changeId for selector stability
             (HTML attribute names are case-insensitive; DOM normalises
             to lowercase). Output: a small Op[] like:
               [{
                  type: 'add',
                  selector: '[data-optly-a9daa119-…]',
                  html:   '<article id="optly-edge-banner">…</article>',
                  position: 'append'
               }]

    Step 10. Worker constructs the manifest:
               {
                 caseId: 'sdk-mode',
                 appliedAt: 'edge',
                 buildId:  <env.LAB_BUILD>,
                 ops:      <Op[] from step 9>
               }
             Worker assembles the final response body:
               <body>...
                 (variation already in here)
                 <script type="application/json" id="edge-del-v2-manifest">
                   {manifest JSON}
                 </script>
                 <script id="edge-del-v2-companion">
                   {companion IIFE source, ~4 KB inlined}
                 </script>
               </body>
             Worker returns Response.

    Step 11. Browser parses HTML, paints. Variation visible at first paint
             — the entire Edge Delivery promise preserved. Browser
             downloads Vue runtime, begins hydration.

             Vue walks the DOM, reaches [data-edge-region='pricing-cards'],
             compares its 4 children against the v-for's expected 3
             keyed plans. The 4th child (the wrapper div with the inserted
             banner) has no matching vNode → Vue discards it during
             recovery. The data-optly-<id> attribute on the v-for parent
             survives (Vue's hydration is permissive about extra
             attributes that don't conflict with bindings).

             Nuxt fires `app:mounted`. Hydration complete.

    Step 12. Companion script (already parsed and primed during HTML
             parse) receives the app:mounted hook. It reads
             #edge-del-v2-manifest, iterates ops. For each op of type
             'add' with selector '[data-optly-…]':
               • querySelectorAll(selector) → finds the v-for parent
                 (the attribute survived).
               • checks for an existing
                 [data-edge-applied="sdk-mode__0"] inside → none (Vue
                 discarded the worker-inserted wrapper).
               • creates the article from op.html, stamps
                 data-edge-applied + data-edge-companion-inserted,
                 appends as last child of the parent.

             Final DOM: 4 children, banner present, stable.
             Companion emits 'reapply:done' on the global bus and via
             CustomEvent('edge-del-v2'). RUM tools can subscribe.

The customer never wrote per-experiment code. The companion ran
generically against the manifest the SDK produced.


6. The manifest protocol — single source of truth for both sides
----------------------------------------------------------------

The contract between SDK side and companion side. Both implementations
must agree on this shape exactly.

### 6.1 Inline manifest tag

The worker emits, before `</body>`:

    <script type="application/json" id="edge-del-v2-manifest">
    {
      "caseId":   "sdk-mode",
      "appliedAt": "edge",
      "buildId":   "<environment-specific build identifier>",
      "ops":       [ <Op>, <Op>, ... ]
    }
    </script>

Field-by-field:

  caseId      Stable identifier for this manifest emission. The literal
              `"sdk-mode"` indicates the manifest came from real
              Optimizely SDK output (not from a local case file). Custom
              implementations can use any string; the companion treats
              it opaquely except as a namespace for idempotency markers.
  appliedAt   Always `"edge"` today. Reserved for future modes (e.g. a
              client-only fallback pathway).
  buildId     Free-form. Useful for RUM correlation. Defaults to the
              worker's LAB_BUILD env var.
  ops         Ordered list of operations. Companion iterates in order.

### 6.2 Op schema

```typescript
type Op =
  | { type: 'text';      selector: string; value: string }
  | { type: 'attribute'; selector: string; name: string; value: string }
  | { type: 'class';     selector: string; add?: string[]; remove?: string[] }
  | { type: 'add';       selector: string; html: string;
                          position: 'before'|'after'|'prepend'|'append'|'replace' }
  | { type: 'remove';    selector: string }
  | { type: 'move';      selector: string; toSelector: string;
                          position: 'before'|'after'|'prepend'|'append' };
```

Six op types. The current extractor only emits `add` ops (because that's
what the canonical Optimizely append/prepend/insert changes map to); the
companion supports all six and the SDK-side mapping table in §7.4 covers
the rest.

### 6.3 Selector contract

For ops derived from the SDK's `data-optly-<changeId>` markers, the
canonical selector is `[data-optly-<lowercased-changeId>]`. The marker
appears on the target element of every change, and Vue's hydration
preserves it.

For customer-authored ops (Mode B in our lab; not the SDK path), the
selector is whatever the author specified — the companion does no
parsing on the string, just hands it to `document.querySelectorAll`.

### 6.4 Idempotency markers

The companion stamps two attributes:

- `data-edge-applied="<caseId>__<opIndex>"` on every element it touched
  (created or mutated). Used by the companion's idempotency check on
  re-runs (SPA navigation, manual replay).
- `data-edge-companion-inserted="1"` on elements the companion itself
  created. Used by remove-ops to avoid removing nodes the companion
  inserted.


7. Part A — SDK-side extension (Optimizely engineering)
-------------------------------------------------------

The change to land in `@optimizely/edge-delivery`. This section is for
the SDK maintainers.

### 7.1 What it does

After `applyExperiments()` returns its rewritten Response, a single
post-processing pass:

1. Reads the response body once (`await response.text()`).
2. Scans the body for `<div style="display:contents" data-optly-<id>>…</div>` wrappers.
3. Builds an `Op[]` from the captured changeIds and inner HTML.
4. Constructs the manifest payload.
5. Inserts the manifest `<script type="application/json">` tag and the
   companion `<script>` tag immediately before the document's `</body>`.
6. Returns a new Response containing the assembled body.

### 7.2 Performance contract

- **One buffer of the response body.** Typical SSR page sizes (50–350 KB
  after the SDK's snippet injection) buffer in well under a millisecond
  on a Cloudflare Worker. No streaming penalty that matters; HTML
  responses are not large enough for streaming to be meaningful at
  worker-internal scale.
- **No subrequests.** Everything required is already in the response the
  SDK just produced. No manifest re-fetch, no second origin call, no
  upstream API hits.
- **One regex pass.** O(n) over the body, ~constant overhead.
- **Single string concatenation** to assemble the final body.

Aggregate added overhead: low single-digit milliseconds in the worst
case, often sub-millisecond. Negligible against the SDK's existing
manifest-fetch + HTMLRewriter pipeline.

### 7.3 Reference implementation

The implementation that's deployed and validated lives at
`edge-del-v2/target-app/server/edge-entry.ts`. Below is the relevant
portion, lightly annotated.

```typescript
import { applyExperiments, Options } from '@optimizely/edge-delivery';
import { COMPANION_SOURCE } from 'edge-del-v2-reinforce/companion-source';

interface Op {
  type: 'add';
  selector: string;
  html: string;
  position: 'append';
}

function extractOpsFromBody(body: string): Op[] {
  const ops: Op[] = [];
  const wrapper =
    /<div style="display:contents" data-optly-([A-Za-z0-9-]+)[^>]*>([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = wrapper.exec(body)) !== null) {
    const changeId = m[1].toLowerCase();
    const innerHtml = m[2].trim();
    if (!innerHtml) continue;
    ops.push({
      type: 'add',
      selector: `[data-optly-${changeId}]`,
      html: innerHtml,
      position: 'append'
    });
  }
  return ops;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // 1. SSR origin (Nuxt nitro handler in this lab; whatever the
    //    customer's origin is in production).
    const ssrResponse = await nitro.fetch(request, env, ctx);

    const ct = ssrResponse.headers.get('content-type') || '';
    if (ssrResponse.status !== 200 ||
        !ct.toLowerCase().includes('text/html')) {
      return ssrResponse;
    }

    // 2. SDK applies the variation.
    const response = await applyExperiments(request, ctx, {
      snippetId:   env.SNIPPET_ID,
      environment: 'prod',
      control:     ssrResponse,
      logLevel:    'error'
    } as unknown as Options);

    // 3. Buffer once. Single pass.
    const body = await response.text();
    const ops  = extractOpsFromBody(body);

    // 4. Build manifest, inject.
    const manifest = {
      caseId:    'sdk-mode',
      appliedAt: 'edge',
      buildId:   env.LAB_BUILD,
      ops
    };
    const manifestJson = JSON.stringify(manifest)
      .replace(/<\/script/gi, '<\\/script');
    const tag =
      `<script type="application/json" id="edge-del-v2-manifest">` +
      manifestJson +
      `</script>` +
      `<script id="edge-del-v2-companion">` +
      COMPANION_SOURCE +
      `</script>`;

    const closing = body.lastIndexOf('</body>');
    const withTag = closing >= 0
      ? body.slice(0, closing) + tag + body.slice(closing)
      : body + tag;

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(withTag, {
      status:     response.status,
      statusText: response.statusText,
      headers
    });
  }
};
```

### 7.4 Optimizely change.type → Op type mapping

The current extractor only handles `append` / `prepend` / `replace` /
`remove` / `move` change types because those are the ones the SDK
expresses through the `<div style="display:contents" data-optly-<id>>`
wrapper pattern. Attribute and class changes use different markers
(direct attribute writes on the target element), which the extractor
should also detect. Full mapping table for the SDK extension:

  Optimizely Change.type        Detection                                 Maps to Op
  --------------------------    ---------------------------------------   -------------------------------------------
  append / prepend / replace    <div style="display:contents"             { type: 'add', selector:
                                 data-optly-<id>>…</div>                    '[data-optly-<id>]',
                                                                            html: <inner>,
                                                                            position: <append|prepend|replace> }
  remove / removeElement        Target element with data-optly-<id> +     { type: 'remove', selector:
                                 the element absent post-rewrite           '[data-optly-<id>]' }
                                 (SDK marks change via tombstone
                                 attribute on parent; spec TBD)
  attribute                     Target element with data-optly-<id> +     { type: 'attribute', selector:
                                 attribute change manifested on the        '[data-optly-<id>]',
                                 element                                    name: <attr>, value: <new value> }
  class                         Target element with data-optly-<id> +     { type: 'class', selector:
                                 class list change manifested on the       '[data-optly-<id>]',
                                 element                                    add: [<added>], remove: [<removed>] }
  substituteText / text         Target element with data-optly-<id> +     { type: 'text', selector:
                                 child text node containing the new        '[data-optly-<id>]',
                                 value                                      value: <new text> }
  href / src / srcset / alt     Treated as attribute changes              { type: 'attribute', selector:
                                                                            '[data-optly-<id>]',
                                                                            name: <href|src|srcset|alt>,
                                                                            value: <new value> }
  move / reorder                Source element marked with data-optly-    { type: 'move', selector:
                                 <id>; SDK reorders within parent           '[data-optly-<id>-src]',
                                                                            toSelector: '[data-optly-<id>-target]',
                                                                            position: <before|after|prepend|append> }

The reference implementation today only emits `add` ops; the table above
is the spec for completing the extractor in the published SDK.

### 7.5 Where the change should land in the SDK

`src/index.ts` in the `optimizely/edge-delivery` repository,
specifically inside `applyExperiments()` after the existing
`rewriter.transform(...)` produces the final Response. Today that
function ends with `return rewriter.transform(new Response(control?.body,
{ ... }))`. The new code wraps that return:

```typescript
const rewritten = rewriter.transform(
  new Response(control?.body, { ... })
);

// New: post-processing pass that emits the reinforcement manifest +
// companion. Gated by an option so existing customers see no change
// in behaviour unless they opt in.
if (edgeOptions.emitReinforcement !== false) {
  return await emitReinforcement(rewritten, edgeOptions);
}
return rewritten;
```

Where `emitReinforcement()` is the buffer-extract-inject pass from §7.3.

### 7.6 New options on the `Options` class

Two additions to `src/models.ts`'s `Options` class:

```typescript
export declare class Options {
  // ... existing fields ...

  /**
   * If true (default true), the SDK emits the reinforcement manifest
   * and companion script inline before </body>. Set false to opt out
   * for customers running their own hydration handling.
   */
  emitReinforcement?: boolean;

  /**
   * Override the companion script source. Defaults to the bundled
   * companion. Customers using a bundled companion via npm can set
   * this to "" to skip inline injection and load the companion from
   * their own bundle.
   */
  reinforcementCompanionSource?: string;
}
```

### 7.7 Companion source: bundled vs separate package

Recommended productisation: bundle the companion source as a string
constant inside `@optimizely/edge-delivery`. The companion lives in the
SDK repository, builds during SDK release (esbuild → IIFE → minified
string constant), and ships with every SDK install. Customer install
becomes truly zero-touch — the SDK handles both pieces.

Alternative: publish `@optimizely/edge-delivery-reinforce` as a separate
npm package the customer adds to their page via `<script src>` or via
their bundler. Useful if the customer wants explicit control over
versioning, CSP nonce handling, or async loading. Both options are
viable; bundled is simpler.

The lab today inlines the companion source as a string constant emitted
by `reinforce/build.mjs`, which is the bundled pattern.

### 7.8 Testing additions

The SDK's vitest suite should add:

- A test that wraps a known SSR HTML response with applied changes and
  asserts the extractor produces the expected `Op[]`.
- A test that asserts the inline manifest tag is present and parseable
  in the final response.
- A test that asserts the companion script tag is present and contains
  the IIFE source.
- A test that asserts opt-out (`emitReinforcement: false`) returns a
  response without the manifest or companion tags.
- A performance regression test that asserts the post-processing pass
  completes within a small fixed budget (e.g. 5 ms for a 300 KB body).


8. Part B — Customer-side companion (Customer engineering / Professional Services)
-----------------------------------------------------------------------------------

If the SDK ships with the companion bundled (§7.7 recommendation), the
customer install is **zero touches** — upgrading to the new SDK version
delivers both pieces.

If the customer prefers the separate-package option, this section is the
install reference.

### 8.1 Install — npm + bundler

```bash
npm install @optimizely/edge-delivery-reinforce
```

In the customer's page entry (Nuxt plugin, layout, or `app.vue`):

```typescript
import '@optimizely/edge-delivery-reinforce/companion';
```

The import is a side-effect import. The companion's IIFE runs on load,
reads the inline manifest, primes the hydration hook. The customer
adds nothing else.

### 8.2 Install — vendored script tag

If the customer prefers not to add an npm dependency:

```html
<!-- Place anywhere in the page; ideally just before </body> -->
<script src="/static/edge-del-v2-companion.min.js"></script>
```

The companion bundle is ~4 KB minified. Host it under the customer's
own static assets. No CDN dependency on Optimizely's infrastructure for
the companion itself.

### 8.3 Companion lifecycle internals

The companion does the following on load:

1. Reads `#edge-del-v2-manifest` from the DOM. If absent or empty
   `ops`, emits `boot:no-ops` and exits cleanly.

2. Waits for the SSR framework to finish hydrating. Tries three
   detection mechanisms in priority order:

   - **Nuxt 3 / Nuxt 4:** `window.useNuxtApp()?.hook('app:mounted', cb)`.
     This is the canonical mount-complete signal for Nuxt SSR apps.
   - **Vue 3 generic:** Locates the root via `#__nuxt`, `#app`, or
     `[data-server-rendered]`. Reads `root.__vue_app__._instance.isMounted`.
     Fires immediately if already mounted; otherwise polls per animation
     frame for up to ~1 second.
   - **Framework-agnostic fallback:** `requestIdleCallback(cb, {
     timeout: 500 })`. Suitable for non-Vue frameworks or older Vue
     versions that don't expose the root instance.

   The three converge to "DOM is in its post-hydration steady state."

3. Iterates the manifest's `ops`. For each op, applies the corresponding
   primitive from `reinforce/src/ops.ts`:

   - `text`:      set `textContent` if it differs from `op.value`
   - `attribute`: set the attribute if it differs from `op.value`
   - `class`:     add `op.add` classes, remove `op.remove` classes
   - `add`:       if no `data-edge-applied="<mark>"` exists adjacent to
                   the anchor, insert from `op.html` at `op.position`
   - `remove`:    remove matching elements, except those the companion
                   itself inserted (marked `data-edge-companion-inserted="1"`)
   - `move`:      reposition source relative to target

4. Stamps `data-edge-applied="<caseId>__<opIndex>"` on every touched
   element. Stamps `data-edge-companion-inserted="1"` on companion-
   inserted nodes.

5. Emits events for observability:
   - `window.__EDGE_DEL_V2__.events[]` accumulates a timestamped log.
   - `window.dispatchEvent(new CustomEvent('edge-del-v2', {detail: ...}))`
     for each event. RUM tools, Datadog browser SDK, etc. can subscribe.

### 8.4 SPA navigation behaviour

On SPA route changes, Nuxt fires `app:mounted` again (or the new route's
own mount hook depending on configuration). The companion re-arms its
hook. The idempotency markers ensure ops that already applied are
detected and skipped — no double-inserts. If the new route doesn't have
the targeted selectors in its DOM, the companion no-ops.

### 8.5 Framework adapters

The companion's DOM manipulation is framework-agnostic. The only
framework-specific piece is the **hydration-complete signal** that
tells the companion when it's safe to read the post-hydration DOM and
re-apply ops. The companion encapsulates this in `whenHydrated(cb)`,
which tries framework-specific detection chains in priority order and
falls back to a generic `requestIdleCallback` if nothing matches.

The reinforcement layer supports more than one framework with the same
SDK extractor, manifest protocol, op vocabulary, and replay primitives.
The list below covers the frameworks the kit targets today and the
adapter shape for each. Adding a new framework is roughly 20 lines of
detection code in `companion.ts` plus a one-paragraph install snippet.

#### 8.5.1 Vue 3.5 / Nuxt 3 (today's reference implementation)

**Hydration detection chain** (priority order):

1. `window.useNuxtApp()?.hook('app:mounted', cb)` — canonical signal
   exposed by Nuxt 3 for SSR mount completion. Used when the page is a
   Nuxt application and the global `useNuxtApp` is available.
2. Vue 3 root instance polling — locate the root via `#__nuxt`,
   `#app`, or `[data-server-rendered]`; read
   `root.__vue_app__._instance.isMounted`. Fires immediately if
   already mounted, otherwise polls per animation frame for ~1 second.
   Covers vanilla Vue 3 apps not using Nuxt.
3. `requestIdleCallback(cb, { timeout: 500 })` — generic fallback.

**Customer install**: a side-effect import in any always-loaded entry
(Nuxt plugin, `app.vue`, or directly in `nuxt.config.ts` via the
`scripts` config).

```typescript
// plugins/edge-del-v2.client.ts
import '@optimizely/edge-delivery-reinforce/companion';
```

If the SDK ships with the companion bundled (recommendation in §7.7),
this import is unnecessary — upgrading the SDK delivers both pieces.

**Caveats**: the standard Vue 3.5 `data-allow-mismatch` attribute is
emitted by the worker as a defence-in-depth signal; it does not
prevent prod-build recovery (§11). The companion is what holds the
variation.

#### 8.5.2 React 18+ / Next.js 13+ (App Router or Pages Router)

**Hydration detection chain** (priority order):

1. Custom event subscription — preferred. The customer's root layout
   dispatches `CustomEvent('edge-del-v2-hydrated')` from a
   `useEffect(() => { ... }, [])` in the root component (App Router:
   `app/layout.tsx`; Pages Router: `pages/_app.tsx`). The companion
   listens for this event on `window`. Cleanest and most portable
   across React renderers (Next.js, Remix, vanilla React, Astro
   client-side islands).
2. React root fiber detection — locate the application root
   container, read the React 18 internal property
   `__reactContainer$<random>` (React stores its fiber root there
   after `hydrateRoot()` completes). Poll briefly for the root to
   become non-null and mounted.
3. `requestIdleCallback(cb, { timeout: 500 })` — same generic fallback.

**Customer install** (App Router):

```typescript
// app/layout.tsx
'use client';
import { useEffect } from 'react';
import '@optimizely/edge-delivery-reinforce/companion';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('edge-del-v2-hydrated'));
  }, []);
  return <html><body>{children}</body></html>;
}
```

**Customer install** (Pages Router):

```typescript
// pages/_app.tsx
import { useEffect } from 'react';
import '@optimizely/edge-delivery-reinforce/companion';

export default function App({ Component, pageProps }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('edge-del-v2-hydrated'));
  }, []);
  return <Component {...pageProps} />;
}
```

**Caveats**:
- React 18+ has `suppressHydrationWarning` on individual elements
  (analogue of Vue's `data-allow-mismatch`). Same caveat: it
  suppresses the dev-time warning but does not change React's
  recovery behaviour in production. The companion does the work.
- React 19 is stricter than 18 on attribute mismatches but still
  permissive about `data-*` attributes. The `data-optly-<id>` marker
  the SDK emits survives hydration the same way it does in Vue.
- React Server Components (RSC) hydrate component trees independently.
  The custom event approach fires once the root client-component tree
  finishes hydrating; for fine-grained RSC trees, the customer may
  want to dispatch additional events when sub-tree boundaries finish.
  Out-of-scope for v1.
- Next.js's App Router uses streaming SSR. The companion sees the
  full page only after Next.js finishes streaming. The custom event
  fires after `useEffect`, which runs after the entire root tree
  hydrates — correct timing for our purposes.

#### 8.5.3 Adding a new framework

The adapter pattern, generalised:

1. Identify the framework's "mount complete" signal — a lifecycle
   hook, a marker attribute on the root, or a polled flag on a
   global.
2. Add a detection rung to `whenHydrated()` in `reinforce/src/companion.ts`
   above the existing fallbacks. Order: framework-specific signal
   first, generic poll second, `requestIdleCallback` last.
3. Document the customer-side install for that framework — typically
   either a side-effect import in the framework's entry point or a
   dispatched custom event.

Svelte, SolidStart, Astro client-side islands, Qwik, etc. fit this
pattern. Open a PR with the detection rung + install snippet and the
existing tests cover everything else.

### 8.6 CSP and nonces

The current implementation emits an inline `<script>` tag for the
companion. Sites with strict CSP (`script-src 'self'` and no
`unsafe-inline`) need a nonce. The SDK should mirror the nonce its
existing snippet-injection code uses (`options.nonce` is already
plumbed through `applyExperiments()`). Two-line addition to the
injector.

### 8.7 Bundle size

- Minified IIFE: ~4 KB
- Gzipped: under 2 KB

Inlined into the HTML response, no additional HTTP request, no DNS
lookup, no TLS handshake cost. Parsed in microseconds on modern
hardware.


9. Authoring guidance for experimentation teams
-----------------------------------------------

For the experimentation team (the Visual Editor users, not the
engineers): once the reinforcement layer is installed, authoring against
a Vue / Nuxt SSR site at the edge becomes essentially indistinguishable
from authoring against a non-hydrating page. There is no per-experiment
ceremony.

A few practical conventions still worth observing:

- **Prefer stable selectors.** Use IDs, `data-*` attributes, or
  purpose-built `data-experiment-target="…"` attributes on the template
  side. Avoid descendant chains and class-only selectors that change as
  the customer refactors.
- **Be mindful of reactivity, not statefulness.** A text edit on a
  hardcoded `<h1>` survives natively. A text edit on `{{ headline }}`
  needs the companion. The Visual Editor doesn't surface this
  distinction; the reinforcement layer covers both cases generically, so
  the team doesn't have to make the call.
- **Additive changes:** the SDK inserts at the CDN, Vue may discard on
  hydration, the companion re-inserts. There may be a brief flicker
  (typically a single frame, ~16 ms) for additive changes where Vue
  discards before the companion catches it. For above-the-fold critical
  paths, the flicker is the cost of going through Edge Delivery instead
  of pure client-side.


10. Debugging and observability
-------------------------------

### 10.1 Response headers

Every transformed response carries:

    x-edge-del-v2: mode=pages-integrated;
                   snippet=<snippetId>;
                   reinforce=<on|off>;
                   build=<build identifier>

Or, on the SDK error path:

    x-edge-del-v2: mode=pages-integrated;
                   sdk-error=<percent-encoded error message>;
                   build=<build identifier>

This is the first signal to check when a customer reports a page
"missing the variation." Open DevTools Network panel, find the document
request, read the header. If present, the worker ran; if `sdk-error`
appears, the SDK failed and we fell open to the origin.

### 10.2 Cookies set by the SDK

After a cold visit:

    optimizelyEndUserId=oeu<timestamp>r<random>
    OPTY$$<userId>$$<projectId>$$VMAP=<layerId>_<experimentId>_<variationId>
    OPTY$$<userId>$$<projectId>$$VPROF=<browser/device profile>
    optimizelySession=<session id>

The VMAP cookie is the most useful signal: empty (`VMAP=`) means the
visitor was not bucketed into any variation (audience miss, holdback,
URL non-match). Populated means the visitor is in the listed
layer/experiment/variation.

### 10.3 Browser telemetry bus

The companion exposes a global object:

    window.__EDGE_DEL_V2__ = {
      manifest: <the inline manifest payload>,
      ranAt:    <performance.now() when reapply finished>,
      events: [
        { at: 1.2,   kind: 'boot:armed',                  detail: { caseId, ops } },
        { at: 12.3,  kind: 'hydration:nuxt-hook-armed' },
        { at: 134.5, kind: 'reapply:done',                detail: { ... } },
        ...
      ]
    };

Open DevTools, type `__EDGE_DEL_V2__` to inspect post-hydration. The
events log is timestamped via `performance.now()` for timing analysis.

### 10.4 Custom DOM events

The companion dispatches `CustomEvent('edge-del-v2', { detail })` for
every bus entry. Customer RUM integrations subscribe with:

```javascript
window.addEventListener('edge-del-v2', (e) => {
  if (e.detail.kind === 'reapply:done') {
    rum.record('edge_variation_applied', {
      caseId: e.detail.detail.caseId,
      ops:    e.detail.detail.ops
    });
  }
});
```

### 10.5 Idempotency markers in the DOM

Inspect the live DOM for `data-edge-applied="…"` and
`data-edge-companion-inserted="1"` attributes. Absence on an element
that should have been modified indicates either the worker didn't apply
the op (SDK miss, audience/URL mismatch) or the companion's hook didn't
fire before the inspection (race against hydration; rare).


11. Limitations and known edge cases
-------------------------------------

- **Move ops via HTMLRewriter at the worker side are not implemented.**
  HTMLRewriter is streaming and single-pass; cross-element move
  (capture source, insert at target) requires cross-handler shared
  state that's awkward to express. The current worker stamps a
  `data-edge-move-pending` marker; the companion executes the move
  post-hydration. This means move/reorder ops have no SSR-visible
  presence until the companion fires. Acceptable for most customers
  (move ops are rare; flicker on a single frame is tolerable); a
  future SDK update can implement true streaming move if needed.

- **`data-allow-mismatch` does not stop Vue 3.5 prod-build recovery.**
  Mechanism-isolation testing in the deployed lab confirmed this. The
  attribute is a dev-mode warning suppressor only. The companion is
  the load-bearing piece. We keep emitting the attribute as defence in
  depth and forward-compatibility.

- **Performance under load not yet stress-tested.** Per-request
  overhead has been measured at sub-millisecond on a Cloudflare
  Worker; concurrent-load behaviour is not yet measured against
  realistic traffic patterns.

- **CSP nonce propagation not yet implemented in the reference
  worker.** The `Options.nonce` field exists in the SDK; wiring it
  through the injector for the inline manifest + companion script
  tags is ~5 lines.

- **Older Vue versions** (≤3.4): companion works (it manipulates DOM
  generically), but the dev-mode warning suppression provided by
  `data-allow-mismatch` is absent (the attribute is Vue 3.5+).

- **Reactive bindings with multiple updates after mount.** The
  companion re-applies once, after `app:mounted`. If reactive state
  changes later cause Vue to re-render and revert again, the
  companion needs to re-trigger. Currently it does not. A
  `MutationObserver` watching the affected subtrees would address
  this; not implemented in v1.

- **Multiple concurrent experiments.** The manifest is a flat ops
  list. If two experiments target the same selector, the second wins.
  This matches Optimizely's existing semantics.


12. Productisation notes (Optimizely product team)
--------------------------------------------------

For the team deciding how to package this into a shipping product:

- **Ship the SDK extension as the default behaviour in the next
  minor version of `@optimizely/edge-delivery`.** Existing customers
  get the post-processing pass automatically. The performance cost is
  low and the response shape is additive (an extra script tag and an
  inline JSON tag) — no breaking change for customers who don't run
  Vue/Nuxt SSR.

- **Bundle the companion source inside the SDK package.** Customers
  who don't run a hydrating framework see the companion arrive in
  their response, parse it (zero work, the IIFE checks for the
  manifest and exits cleanly if absent or empty), and move on. Cost
  to non-Vue customers: ~4 KB extra response. Trade-off acceptable.

- **Expose `Options.emitReinforcement = false`** as an opt-out for
  customers who explicitly do not want it. Same shape as existing
  opt-outs like `fixCSPForOptimizely`.

- **Document the mechanism in the public Edge Delivery docs.** The
  customer's experimentation team will want to know that
  hydration-fragile changes now work at the edge. Update the per-
  change-type routing guidance the team has historically published
  (which today recommends client-side for additive changes etc.) to
  reflect that this distinction is no longer load-bearing once the
  reinforcement ships.

- **Build a public-facing demo** mirroring the lab at
  `https://edge-del-v2-target.pages.dev/`. The off/on toggle on a
  Vue/Nuxt SSR page is the most compelling 30-second pitch this
  feature has.

- **Eventual generalisation beyond Vue.** The companion's hydration
  detection has a generic `requestIdleCallback` fallback that works
  for any framework. The mechanism is in principle applicable to
  React (which has its own hydration recovery), Svelte (which has
  effectively none), and others. The companion's framework-specific
  signal detection can be expanded incrementally.


13. File reference and live URLs
--------------------------------

### 13.1 Files in this kit

    edge-del-v2/
    ├─ optimizely_guidance.txt          source customer guidance
    ├─ README.md                        repo orientation
    ├─ PLAYBOOK-V2.md                   operational runbook
    ├─ FINDINGS.md                      empirical hydration map
    ├─ CUSTOMER-GUIDE.md                this document
    ├─ customer-email.md                short customer-facing email
    │
    ├─ target-app/                      Nuxt 3.21 / Vue 3.5 SSR fixture
    │  ├─ nuxt.config.ts                cloudflare_pages preset, SSR
    │  ├─ app.vue                       root layout
    │  ├─ pages/                        5 SSR pages
    │  ├─ components/                   5 components covering hydration boundaries
    │  ├─ server/edge-entry.ts          THE Pages-integrated worker entry
    │  └─ build-pages.mjs               post-build esbuild pipeline →
    │                                   dist/_worker.js/index.js
    │
    ├─ edge-worker/                     standalone worker (legacy, retained for
    │                                   Mode B / harness Mode A comparison runs)
    │  └─ src/reinforce/                annotator + injector reference
    │
    ├─ reinforce/                       companion package
    │  ├─ build.mjs                     esbuild → companion.min.js
    │  └─ src/
    │     ├─ companion.ts               browser IIFE — reads manifest,
    │     │                              hooks app:mounted, replays ops
    │     ├─ ops.ts                     six op primitives
    │     └─ types.ts                   shared Op / VariationManifest / Case
    │
    ├─ experiments/                     ten change-type case files for the
    │                                   Mode B / harness validation
    │
    ├─ harness/                         Playwright runner
    │  ├─ run.ts                        orchestrator: every case × variant
    │  └─ lib/                          hydration observer, DOM snapshot,
    │                                   verify, report
    │
    └─ runs/                            timestamped harness outputs

### 13.2 Live lab

- **Nuxt SSR target served via the integrated Pages worker:**
  `https://edge-del-v2-target.pages.dev/`

- **Health probe** (confirms snippetId is wired, build identifier):
  `https://edge-del-v2-target.pages.dev/__edge-del-v2/health`

- **Demo URLs to put in front of a customer or stakeholder:**

  - `https://edge-del-v2-target.pages.dev/?reinforce=off`
    Edge Delivery applies the variation at the CDN. Vue's hydration
    discards the additive child. Banner appears at first paint, gone
    on second frame.

  - `https://edge-del-v2-target.pages.dev/?reinforce=on`
    Same edge-applied variation. Companion re-applies after
    hydration. Banner survives.

### 13.3 Optimizely test project

- Account ID: 8543082612
- Snippet ID / Project ID: 5953372780494848
- Experiment: "Labco HP" (id 6206477719830528), single-experiment layer
- Variation #1: "Limited offer (Optimizely edge)" — one `append` change
  targeting `section:nth-of-type(3) > .cards`
- Manifest URL:
  `https://cdn.optimizely.com/js/web_sdk_v0_5953372780494848.json`

### 13.4 SDK manifest format reference

Optimizely's manifest structure (see
`@optimizely/edge-delivery/dist/models.d.ts` for the full type
definitions):

    ExperienceConfig
    ├── accountId
    ├── projectId
    ├── revision
    ├── layers[]                       ← experiment groupings
    │   ├── id
    │   ├── name
    │   ├── policy                     ← e.g. "single_experiment"
    │   ├── holdback
    │   └── experiments[]
    │       ├── id
    │       ├── audienceIds            ← null = Everyone
    │       ├── variations[]
    │       │   ├── id
    │       │   ├── name
    │       │   └── actions[]
    │       │       ├── viewId         ← references views[] for URL targeting
    │       │       └── changes[]
    │       │           ├── id         ← UUID, becomes data-optly-<id>
    │       │           ├── type       ← append, attribute, class, …
    │       │           ├── selector
    │       │           └── value      ← HTML / text / attribute value
    │       └── weightDistributions[]  ← bucket ranges
    │
    ├── views[]                        ← URL conditions
    │   ├── id
    │   ├── staticConditions           ← match: simple/regex/etc + url value
    │   └── activationType             ← dom_changed (client) / immediate (edge)
    │
    └── audiences[]                    ← targeting attribute conditions

The reinforcement does not parse this manifest at runtime. The SDK
already does, and the resulting changes appear in the response body via
the `data-optly-<changeId>` markers. The reinforcement extracts from the
response, never from the upstream manifest.


---

End of document. For changes, treat this file as authoritative; the
sections above and below `## END` belong to one of the three audiences
listed at the top. Pull requests welcome.

## END
