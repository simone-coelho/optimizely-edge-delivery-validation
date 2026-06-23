# How it works — read this first

Five minutes. Diagrams, then a step-by-step walkthrough of the edge
side, the client side, and how they hand off to each other.

---

## The 30-second version

Two pieces, no magic.

1. The **edge worker** wraps your existing `applyExperiments()` call.
   After the Optimizely SDK has applied a variation into the SSR
   response, the worker drops two small `<script>` tags into the
   body before `</body>`:
   - a JSON manifest describing the ops the SDK applied
   - a small browser script (the *companion*)

2. The **companion** (in the browser) reads the manifest, waits for
   the framework to finish hydrating, and replays any ops the
   framework's reconciliation undid. It also hooks the History API,
   so the same replay happens when the user SPA-navigates back to a
   page that should have a variation.

No extra HTTP request. No npm install on the browser side. No
per-experiment code anywhere.

---

## The big-picture diagram

```
                        ┌─────────────────────────────────────────────┐
                        │       Cloudflare worker (one fetch)         │
                        │                                             │
                        │   1. SSR handler   → Nuxt/Next response     │
                        │                                             │
   GET /pricing  ─────► │   2. applyExperiments()                     │
                        │      (Optimizely SDK rewrites the body      │
                        │       with the bucketed variation)          │
                        │                                             │
                        │   3. Post-process (NEW):                    │
                        │        scan body for data-optly-<id>        │
                        │        fetch project manifest from          │
                        │           cdn.optimizely.com (cache hit)    │
                        │        build typed Op[]                     │
                        │                                             │
                        │   4. Inject two <script> tags before        │
                        │      </body>:                               │
                        │        <script type=application/json> …Op[] │
                        │        <script>…companion IIFE…</script>    │
                        │                                             │
                        │   5. Return assembled Response              │
                        └─────────────────────────────────────────────┘
                                          │
                                          ▼  one HTML response,
                                             variation in the bytes,
                                             companion inline
                        ┌─────────────────────────────────────────────┐
                        │                  Browser                    │
                        │                                             │
                        │   First paint — variation visible.          │
                        │                                             │
                        │   Browser parses HTML, downloads framework  │
                        │   runtime, starts hydration.                │
                        │                                             │
                        │   Vue/React walks the SSR DOM, reconciles   │
                        │   against vDOM. May discard "unexpected"    │
                        │   nodes (the variation).                    │
                        │                                             │
                        │   Companion (already parsed and primed):    │
                        │     • reads inline manifest                 │
                        │     • waits for framework's "mounted"       │
                        │       signal (Vue's app:mounted, React's    │
                        │       first useEffect, requestIdleCallback) │
                        │     • iterates ops idempotently             │
                        │     • re-applies anything the framework     │
                        │       undid                                 │
                        │                                             │
                        │   History API hooks installed → on every    │
                        │   pushState / replaceState / popstate,      │
                        │   replay ops for the current route.         │
                        │                                             │
                        │   Final DOM = variation, post-hydration,    │
                        │   stable across SPA navigation.             │
                        └─────────────────────────────────────────────┘
```

---

## What happens at the edge — step by step

Your existing edge worker already does steps 1 and 2. The new code
is steps 3–5.

```
┌── STEP 1 ─────────────────────────────────────────────────────────┐
│                                                                   │
│  Worker receives:  GET /pricing                                   │
│                                                                   │
│  Calls your SSR handler:                                          │
│     ssrResponse = await yourSsrHandler(request)                   │
│                                                                   │
│  ssrResponse body looks like:                                     │
│     <html><head>…</head><body>                                    │
│       <header class="hasTransparentGnavBackground">…</header>     │
│       <main>                                                      │
│         <h1>Hire on Lab Co.</h1>                                  │
│         <p>placeholder content…</p>                               │
│       </main>                                                     │
│     </body></html>                                                │
└───────────────────────────────────────────────────────────────────┘
                                ▼
┌── STEP 2 ─────────────────────────────────────────────────────────┐
│                                                                   │
│  applyExperiments(request, ctx, { control: ssrResponse })         │
│                                                                   │
│  Optimizely SDK:                                                  │
│    • reads project manifest from cdn.optimizely.com               │
│    • evaluates audience, URL targeting, bucketing                 │
│    • applies variation changes via HTMLRewriter                   │
│    • stamps data-optly-<changeId>="" on every modified element    │
│                                                                   │
│  Response body now:                                               │
│     <html><head>…</head><body>                                    │
│       <header class="" data-optly-b3eca1ba=…>…</header>           │
│       <main data-optly-6ac44778=…>                                │
│         <div id="opt-1445">Sponsored Job plans</div>              │
│         <div class="opt-moo-1399">FAQ</div>                       │
│         <h1>Hire on Lab Co.</h1>     ← original placeholder       │
│       </main>                                                     │
│     </body></html>                                                │
└───────────────────────────────────────────────────────────────────┘
                                ▼
┌── STEP 3 ─── NEW ─────────────────────────────────────────────────┐
│                                                                   │
│  body = await response.text();                                    │
│                                                                   │
│  findMarkerIds(body)   →   Set { 'b3eca1ba…', '6ac44778…' }       │
│                                                                   │
│  fetchManifest(snippetId)                                         │
│     → GET cdn.optimizely.com/js/web_sdk_v0_<id>.json              │
│     → cache hit on the same CF edge that just served the SDK      │
│     → ~1 ms                                                       │
│                                                                   │
│  For each marker ID:                                              │
│     lookup the change in the manifest                             │
│     convert to our Op vocabulary:                                 │
│        Optimizely "append"    → { type: "add", selector, html }   │
│        Optimizely "attribute" → { type: "attribute", … }          │
│        Optimizely "rearrange" → { type: "move", … }               │
│        Optimizely "custom_code" → skipped (browser-only)          │
│                                                                   │
│  Result:                                                          │
│     ops = [                                                       │
│       { type: "attribute", selector: ".hasTransparent…",          │
│         name: "class", value: "" },                               │
│       { type: "add", selector: "main",                            │
│         position: "prepend",                                      │
│         html: "<div id='opt-1445'>…</div>" }                      │
│     ]                                                             │
└───────────────────────────────────────────────────────────────────┘
                                ▼
┌── STEP 4 ─── NEW ─────────────────────────────────────────────────┐
│                                                                   │
│  manifest = { appliedAt: 'edge', ops };                           │
│  json = JSON.stringify(manifest).replace(/<\/script/g, …);        │
│                                                                   │
│  injection =                                                      │
│    `<script type="application/json"                               │
│      id="edge-del-v2-manifest">${json}</script>` +            │
│    `<script id="edge-del-v2-companion">${COMPANION_SOURCE}</script>`    │
│                                                                   │
│  newBody = body.slice(0, body.lastIndexOf('</body>'))             │
│          + injection                                              │
│          + body.slice(body.lastIndexOf('</body>'))                │
└───────────────────────────────────────────────────────────────────┘
                                ▼
┌── STEP 5 ─────────────────────────────────────────────────────────┐
│                                                                   │
│  return new Response(newBody, {                                   │
│    status: 200,                                                   │
│    headers: { …, 'x-optly-reinforce': 'on' }                      │
│  });                                                              │
│                                                                   │
│  Total worker overhead added by steps 3–5:                        │
│     • 1 body read (already had it)                                │
│     • 1 regex scan                                                │
│     • 1 cdn.optimizely.com fetch (cache-hit)                      │
│     • 1 JSON.stringify                                            │
│     • 1 body slice + concat                                       │
│  Sub-millisecond on a warm cache.                                 │
└───────────────────────────────────────────────────────────────────┘
```

---

## What happens in the client — step by step

The browser receives the HTML response. Everything below happens in
order, in the browser, without any extra HTTP requests.

```
┌── STEP A ─────────────────────────────────────────────────────────┐
│                                                                   │
│  Browser parses HTML top-to-bottom.                               │
│                                                                   │
│  First paint:  variation is visible.                              │
│  View Source:  variation is in the bytes.                         │
│  Search crawlers: see the variation.                              │
│                                                                   │
│  At this point the framework runtime has NOT loaded yet.          │
│  No JS has executed (apart from any blocking head scripts).       │
│                                                                   │
│  This is everything Optimizely Edge Delivery promised. The        │
│  reinforcement layer is invisible so far.                         │
└───────────────────────────────────────────────────────────────────┘
                                ▼
┌── STEP B ─────────────────────────────────────────────────────────┐
│                                                                   │
│  Browser reaches the bottom of <body>. It executes:               │
│                                                                   │
│    <script id="edge-del-v2-companion">                                  │
│      (function(){                                                 │
│        // companion IIFE — runs immediately                       │
│      })();                                                        │
│    </script>                                                      │
│                                                                   │
│  Companion bootstrap:                                             │
│     • read inline manifest (the JSON <script> tag above)          │
│     • cache its parsed ops in a module-scoped variable            │
│     • set up:                                                     │
│         window.__EDGE_DEL_V2__ = { manifest, ranAt, events: [] }  │
│         CustomEvent dispatch on document for RUM integrations     │
│     • emit event: { kind: 'boot:armed' }                          │
│     • install History API hooks (history.pushState patched,       │
│       popstate listener attached) — these will fire on            │
│       SPA navigation later                                        │
│     • emit event: { kind: 'route:history-patched' }               │
│                                                                   │
│  The companion does NOT apply anything yet. It's waiting for      │
│  hydration to start.                                              │
└───────────────────────────────────────────────────────────────────┘
                                ▼
┌── STEP C ─────────────────────────────────────────────────────────┐
│                                                                   │
│  Browser downloads the framework runtime (Vue, React, etc.) and   │
│  starts hydration.                                                │
│                                                                   │
│  Framework walks the SSR DOM, reconciles each node against the    │
│  virtual DOM produced by the page's component code.               │
│                                                                   │
│  For a page with an edge variation:                               │
│     • SSR DOM has variation content (opt-1445, opt-moo-1399, …)   │
│     • vDOM doesn't (the component code rendered the placeholder)  │
│     • framework declares a mismatch                               │
│     • production behaviour: discard the unexpected DOM nodes,     │
│       re-render the component's render() output                   │
│                                                                   │
│  Net result by end of hydration: variation is GONE.               │
│                                                                   │
│  This is the failure mode the snippet-only setup leaves you in.   │
└───────────────────────────────────────────────────────────────────┘
                                ▼
┌── STEP D ─────────────────────────────────────────────────────────┐
│                                                                   │
│  Hydration completes. Framework fires its lifecycle signal:       │
│     Vue/Nuxt:  app:mounted hook                                   │
│     React:    queueMicrotask after first useEffect                │
│     Svelte:   onMount                                             │
│     fallback: requestIdleCallback                                 │
│                                                                   │
│  Companion is hooked into that signal. It now runs the replay:    │
│                                                                   │
│     for each op in manifest.ops:                                  │
│       applyOp(op, mark)                                           │
│                                                                   │
│     applyText(op):       reset textContent, stamp marker          │
│     applyAttribute(op):  reset attribute, stamp marker            │
│     applyClass(op):      add/remove classes, stamp marker         │
│     applyAdd(op):        per-root reconciliation — for each       │
│                          template root, check if a copy exists    │
│                          in the DOM (by id or class+tag); if      │
│                          present, re-stamp the marker; if absent, │
│                          splice it in next to its expected        │
│                          sibling                                  │
│     applyMove(op):       move element to target position          │
│                                                                   │
│  Every touched element gets data-edge-applied="<mark>" so a       │
│  re-run is a no-op.                                               │
│                                                                   │
│  Emit event: { kind: 'initial:applied' }                          │
│  Variation is now visible AND post-hydration-stable.              │
└───────────────────────────────────────────────────────────────────┘
                                ▼
┌── STEP E ─── SPA NAVIGATION ──────────────────────────────────────┐
│                                                                   │
│  User clicks <NuxtLink to="/about">. Nuxt's router calls          │
│  history.pushState. The companion's patched pushState fires.      │
│                                                                   │
│  User clicks back to the variation page. Same hook fires.         │
│                                                                   │
│  Companion:                                                       │
│     • emit event: { kind: 'route:applied' }                       │
│     • iterate manifest.ops, call applyOp on each                  │
│     • idempotent — already-applied ops are no-ops                 │
│                                                                   │
│  Same logic for popstate (back/forward buttons) and for Nuxt's    │
│  page:finish hook (covers cases where pushState isn't used).      │
│                                                                   │
│  This is the part the snippet alone cannot do. The snippet's      │
│  MutationObserver runs once at page load and goes quiet. The      │
│  companion stays subscribed to navigation events for the entire   │
│  session.                                                         │
└───────────────────────────────────────────────────────────────────┘
```

---

## The data contract between the two sides

The only thing the edge worker and the companion share is one
inline JSON tag:

```html
<script type="application/json" id="edge-del-v2-manifest">
{
  "appliedAt": "edge",
  "ops": [
    {
      "type":     "attribute",
      "selector": ".hasTransparentGnavBackground",
      "name":     "class",
      "value":    ""
    },
    {
      "type":     "add",
      "selector": "main",
      "position": "prepend",
      "html":     "<div id=\"opt-1445\">…</div>"
    },
    {
      "type":     "move",
      "selector":   "[data-tn-section=\"header\"]",
      "toSelector": ".opt-moo-1399",
      "position":   "before"
    }
  ]
}
</script>
```

The vocabulary is six op types:

| Type         | What it does                                                      |
| ------------ | ----------------------------------------------------------------- |
| `text`       | Replace `textContent` on every element matching `selector`        |
| `attribute`  | Set a single attribute (`name`, `value`)                          |
| `class`      | Add and/or remove classes (delta-based)                           |
| `add`        | Insert HTML at a position relative to the selector                |
| `remove`     | Remove the matched element                                        |
| `move`       | Move the source element to a position relative to `toSelector`    |

That's the entire surface area. New Optimizely change types can be
added by extending this vocabulary on both sides at the same time.

---

## What changes vs the snippet-only setup

```
                                    SNIPPET           EDGE +
                                     ONLY            COMPANION
                                  ─────────────  ──────────────────
Variation in HTML response?       ✗ (empty slot)  ✓
Visible at first paint?           ✗               ✓
Visible to SEO crawlers?          ✗               ✓
Survives hydration on Vue/React?  N/A             ✓ (companion replays)
Survives SPA navigation?          ✗               ✓ (companion replays)
Extra HTTP request?               1 (the snippet) 0 (companion inlined)
Per-experiment client code?       sometimes        never
Bundle cost?                      ~10 KB (snippet) ~2 KB gzipped
```

---

## Three places to look once the install is live

1. **Network → document response → headers**

   ```
   x-optly-reinforce: on
   ```

   Confirms the worker post-processor ran.

2. **View Source → search `edge-del-v2-companion`**

   You should find two `<script>` tags near the bottom of the body:
   the JSON manifest and the inline IIFE.

3. **DevTools console → `__EDGE_DEL_V2__`**

   ```js
   {
     manifest: { ops: [...] },
     ranAt:    134.2,
     events: [
       { at:  1.2, kind: 'boot:armed' },
       { at:  3.4, kind: 'route:history-patched' },
       { at: 89.1, kind: 'hydration:nuxt-hook-armed' },
       { at: 134.2, kind: 'initial:applied' },
       …
     ]
   }
   ```

   Confirms the companion executed, hydrated against the right
   framework signal, and replayed the ops.

---

## Next reading

- The customer's manager / experimentation lead reads
  `1-customer-summary.md`.
- The customer's engineer reads `2-engineering-handbook.md`, then
  `code/README.md`.
- The Optimizely SA reads `3-solutions-architect-playbook.md` for
  the engagement playbook.
- The deep reference is `reinforcement-layer/CUSTOMER-GUIDE.md` —
  1,300 lines, only open if a training-pack doc points you to a
  specific section.
