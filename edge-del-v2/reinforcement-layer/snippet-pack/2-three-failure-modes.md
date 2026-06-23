# 2 — The three failure modes (and how the companion handles each)

This is the heart of the pack. Three things go wrong on SCA, the
companion handles all three, and you should understand each before
shipping.

## Failure mode 1 — Timing

### What happens

The Optimizely snippet runs at the top of `<head>`. At that moment,
the page's `<body>` is mostly empty — the SSP shell template, plus a
container like `<div id="main-content"></div>`. Backbone hasn't
fetched the route's data, hasn't instantiated the view, hasn't
rendered.

If your experiment's "Page" is configured with **Activation: Immediate**
(the default) and a CSS selector like `.product-title`, the snippet
checks the DOM at boot, finds no `.product-title`, and silently does
nothing. The view renders 200ms later with the original headline. Your
variation never appeared.

### Why this is a Backbone problem specifically

Modern SSR frameworks (Nuxt, Next.js) render the full HTML on the
server, so `.product-title` exists in the initial HTML response.
Backbone is **client-rendered** — the server sends an empty shell.
There is no headline in the HTML until Backbone runs.

### The fix — three layers, all of them

#### Layer A — Set the experiment's Activation Type to "DOM Change" (NOT Immediate)

In the Optimizely UI, for the experiment's Page:

| Setting | Value |
|---|---|
| Activation Type | DOM Change (NOT Immediate) |
| Activation Code | `document.querySelector('.product-title')` (an expression that returns truthy when the page is ready) |

DOM Change uses Optimizely's MutationObserver. The page activates as
soon as the snippet sees `.product-title` enter the DOM —
which happens right after Backbone's `render()` fires. This is
"Support for Dynamic Websites" doing its job.

#### Layer B — Inside Custom Code changes, use `utils.waitForElement`

Custom Code changes can be authored before the target element exists.
The snippet provides a helper:

```js
const { waitForElement } = window.optimizely.get('utils');

waitForElement('.product-title').then(function (el) {
  el.textContent = 'Built for the Backcountry';
  el.classList.add('variation-headline-bold');
});
```

`waitForElement` is a Promise that resolves when the selector matches.
Internally it uses `MutationObserver` and times out after 2 seconds.

Two seconds is sometimes not long enough. If you have a known-slow
view (heavy data fetch, lazy-loaded chunks), wrap with a longer
fallback:

```js
function waitFor(selector, timeoutMs = 10000) {
  return new Promise(function (resolve, reject) {
    if (document.querySelector(selector)) return resolve(document.querySelector(selector));
    var obs = new MutationObserver(function () {
      var el = document.querySelector(selector);
      if (el) { obs.disconnect(); resolve(el); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); reject(new Error('timeout')); }, timeoutMs);
  });
}
```

Use the Optimizely `utils.waitForElement` first; only reach for this
longer-fallback version if you hit the 2s ceiling on a specific view.

#### Layer C — Prefer Visual Editor primitives over Custom Code

The Visual Editor's "edit text" / "edit class" / "insert HTML"
operations bake in `waitForElement`-style timing for you. A
Visual-Editor text change with selector `.product-title` and value
`"Built for the Backcountry"` is a single Optimizely Change object
that the snippet applies as soon as the selector matches. No custom
JS, no timing logic to write.

This matters more for failure modes 2 and 3 — see
`6-decomposition-not-custom-code.md`.

---

## Failure mode 2 — SPA navigation

### What happens

User loads the product detail page. Variation A applies. Headline
reads "Built for the Backcountry."

User clicks the cart icon. Backbone routes to `/cart`. The view
swaps. `view.render()` writes new HTML into `#main-content`.

User clicks back to PDP. Backbone routes back. Old view re-renders.
`.product-title` is back, but it now reads "Premium Daypack" — the
control headline. Variation gone.

### Why this happens

Optimizely's snippet decided once, on initial activation, that this
visitor should see Variation A on the PDP page. The snippet applied
the text change to the `.product-title` it saw in the DOM at that
moment. When Backbone removed and re-rendered the view, the snippet
**doesn't know** the PDP page is "active again" — from its
perspective, nothing happened. No event. No re-evaluation.

"Support for Dynamic Websites" addresses **some** of this — its
MutationObserver re-applies changes to elements that get replaced
inside an already-active page. But it has known gaps:

- For **section-level swaps** (not a full route change, but a
  re-render of `#main-content`), DSW's reapply logic depends on
  whether the new elements satisfy the page's `staticConditions`.
  Sometimes yes, sometimes no.
- For **route changes**, DSW expects you to declare each route as a
  separate "Page" in the Optimizely UI. If you have a generic page
  targeting `*/product/*`, the navigation between product A and
  product B might not re-trigger activation.

### The fix — the companion's `onRouteChange` adapter

The companion subscribes to Backbone's own router:

```js
Backbone.history.on('route', function (router, name) {
  // Re-derive variation ops for the new URL.
  // Re-apply.
});
```

`Backbone.history.on('route', cb)` fires **after** Backbone has
finished rendering the new view. It's the cleanest signal a Backbone
SPA has. Per route change:

1. Re-read `window.optimizely.get('data')` and
   `state.getVariationMap()`. (See research-clientside-api.md §3.5
   and §3.2 if you need a deeper reference.)
2. For each experiment, evaluate URL targeting against the new URL.
3. For each matching, bucketed experiment, walk the variation's
   `actions[].changes[]` and convert each to an internal Op
   (`text`, `attribute`, `add`, `remove`, `move`).
4. Apply each Op idempotently, stamping a `data-edge-applied="<id>"`
   marker on every mutated/inserted element. If a marker already
   exists for that change, the apply is a no-op — so if DSW also
   re-applied first, the companion does nothing.

The companion also listens to:

- `window.addEventListener('hashchange', …)` — covers Backbone
  configurations using hash routing (`Backbone.history.start({ pushState: false })`).
- `history.pushState` / `replaceState` / `popstate` — covers
  third-party code in SCA that navigates outside the Backbone router.

You don't have to write any of this. The companion does it.

---

## Failure mode 3 — Section re-render

### What happens

User on the PDP. Variation B's text change has applied — headline reads
"Pro-Grade Construction."

User clicks "View cart" in the mini-cart icon (the slide-out cart panel,
not a route change). Backbone's `MiniCartView` re-renders. The DOM
under `#mini-cart` is replaced.

If Variation B included an `insert_html` change that put a small
"Free shipping over $50" banner inside the mini-cart, that banner is
gone after the re-render.

### Why this is different from failure mode 2

No URL change. No Backbone route event. From the snippet's
perspective, nothing about the page has changed — and DSW's
MutationObserver IS watching, but its re-apply logic checks whether
the new elements satisfy the experiment's targeting. The targeting
matched the URL initially, the URL hasn't changed, so the experiment
IS still active — and DSW should re-apply.

In practice, DSW catches some of these and misses others. Documented
gaps:

> "Insert HTML and insert image changes [...] are only reapplied when
>  new elements display." — *Dynamic websites and SPAs*

A re-rendered mini-cart container creates new elements; DSW should
catch it. But:

> "React hydration often involves rapid, batched DOM updates.
>  MutationObservers might not capture all subtle changes."

That same limitation applies to Backbone's batched DOM writes during
a view re-render. The companion's job is to catch what DSW missed.

### The fix — the companion's `observeRerenders` adapter

The companion installs **scoped MutationObservers** on configured
region roots:

```js
window.__EDGE_DEL_V2_CONFIG__ = {
  framework: 'backbone',
  regionRoots: [
    '#mini-cart',          // slide-out cart
    '#cart-content',       // full cart page main region
    '#facets-sidebar',     // PLP facet filter
    '#product-grid',       // PLP results grid
    '#main-content'        // fallback — whole main content area
  ],
  rerenderDebounceMs: 75
};
```

For each `regionRoots` selector, the companion:

1. Finds the element.
2. Installs a `MutationObserver` with `{ childList: true, subtree: true }`.
3. On any mutation, schedules a re-apply 75ms later (debounce —
   coalesces a burst of mutations into one re-apply).
4. Re-arms automatically if Backbone destroys and recreates the
   container element entirely (cheap document-level observer watching
   for the selector to reappear).

The re-apply re-derives ops from `window.optimizely.get('data')`,
checks markers, applies idempotently. Same engine as the route-change
path.

**Pick region roots by walking the SCA codebase for `Backbone.View.extend({ el: '#…' })`** —
those `el:` values are exactly the region root selectors you want.
Common SCA region roots:

| Container | Why care |
|---|---|
| `#main-content` | The big one — every route change swaps this |
| `#mini-cart` | Mini-cart slide-out |
| `#cart-summary` | Cart subtotal/total area (updates on quantity change) |
| `#facets-sidebar` | Search/PLP facet filter |
| `#product-grid` | Search/PLP results |
| `#header-promotional-banner` | Often a re-rendering region |

Start with `#main-content` plus whichever specific regions a given
experiment touches. You don't need every region — only the ones whose
re-render destroys variation DOM.

---

## Summary — the three fixes in 60 seconds

| Failure | Fix in Optimizely UI | Fix in code |
|---|---|---|
| Timing | Activation: DOM Change | `utils.waitForElement` for Custom Code |
| SPA navigation | DSW on | Companion's `onRouteChange` adapter (auto) |
| Section re-render | DSW on | Companion's `observeRerenders` with regionRoots config |

DSW handles roughly 80% of failure modes 2 and 3 on its own. The
companion catches the remaining 20% and the cases DSW's official
documentation lists as gaps. Run both. Belt and suspenders.
