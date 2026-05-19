Decomposition of Indeed Sponsored Job plans variation
======================================================

**Source variation:** project `19741965684`, experiment `6686084654956544`,
variation `6298220561694720`.
Optimizely UI: https://app.optimizely.com/v2/projects/19741965684/experiments/6686084654956544/variations/6298220561694720

**What's in this folder.**

| File | What it is | Where it goes in Optimizely |
|---|---|---|
| `change-1-insert-html.html` | The full 54 KB resolved HTML payload (pricing tables, FAQ, hire-more, explore-more) | Paste as the value of Change 1 — Insert HTML |
| `change-4-custom-code.js` | ~35-line behaviour shell (FAQ accordion, checkbox exclusivity, tooltip close-on-outside, comparison collapse) | Paste as the value of Change 4 — Custom Code |
| `resolve.js` | The script that produced `change-1-insert-html.html` by resolving the original variation's template literals. Kept so the team can re-run it if the source variation changes | Not pasted into Optimizely — internal artefact |
| `README.md` | This file | Not pasted |

The original variation lived in one Custom Code block. It decomposes
into **four Visual Editor changes**. Three of them apply at the edge;
the fourth is a small Custom Code shell that runs after hydration.


The four changes — what the team authors in Optimizely
------------------------------------------------------

### Change 1 — Insert HTML

| Field | Value |
|---|---|
| Change type | Insert HTML |
| Element selector | `main` |
| Position | Insert at start (afterbegin) |
| HTML | Open `change-1-insert-html.html`, copy everything, paste into the HTML input |

This is the heaviest change by bytes (54 KB). It replaces what the
original variation injected via `e.insertAdjacentHTML("afterbegin", …)`
at runtime, but now applied at the CDN by HTMLRewriter so the content
is in the SSR response and visible at first paint.

### Change 2 — Class change (remove `hasTransparentGnavBackground`)

| Field | Value |
|---|---|
| Change type | Attribute → Class |
| Element selector | `.hasTransparentGnavBackground` |
| Operation | Remove class |
| Class name | `hasTransparentGnavBackground` |

Replaces:
```js
modifyElementWithCallback(".hasTransparentGnavBackground", (e) => {
  e.classList.remove("hasTransparentGnavBackground");
});
```

### Change 3 — Rearrange `[data-tn-section="header"]` (URL-conditional)

| Field | Value |
|---|---|
| Change type | Rearrange |
| Source element | `[data-tn-section="header"]` |
| Target element | `.opt-moo-1399` |
| Position | Before |
| URL targeting | URL contains `/hire/cs/pricing` |

Replaces:
```js
if (window.location.href.indexOf("/hire/cs/pricing") > -1) {
  waitForElement('[data-tn-section="header"]').then(function (header) {
    document.querySelector(".opt-moo-1399").insertAdjacentElement("beforebegin", header);
  });
}
```

The inline URL conditional in the original disappears — the targeting
moves up to the experiment's URL match condition. If the experiment
already only runs on `/hire/cs/pricing`, no URL targeting is needed
on this change; if the experiment also runs on other URLs, either
(a) add a per-change URL condition (if the Visual Editor exposes
one), or (b) split this change into a second experiment narrowed to
the pricing URL.

### Change 4 — Custom Code (the behaviour shell)

| Field | Value |
|---|---|
| Change type | Custom Code |
| Synchronous Timing | Asynchronous |
| Code | Open `change-4-custom-code.js`, copy everything, paste into the Custom Code input |

Replaces all the `addEventListener` blocks inside the original
`modifyElementWithCallback("main", …)` body, plus the document-level
click-outside listener.


What disappears from the original variation
-------------------------------------------

These pieces are no longer needed because the edge / platform handles
their job:

- `waitForElement` function definition — 8 lines.
- `modifyElementWithCallback` function definition + `.opt-1399-set`
  marker class wiring — 5 lines plus all usage sites.
- The `waitForElement('main')` outer wrapper — no longer needed because
  Change 1's selector `main` is resolved by HTMLRewriter at CDN time;
  the element doesn't need to exist on the client at any particular
  moment.
- The `waitForElement('[data-tn-section="header"]')` inside the URL
  conditional — Change 3 handles this; the element is already present
  in the SSR HTML.
- The `if (window.location.href.indexOf(…) > -1)` conditional — pulled
  up to URL targeting on Change 3.


Validation — minimum check after publishing
--------------------------------------------

1. View source on `/hire/cs/pricing` after the experiment is active.
   The HTML should contain `<div id="opt-1445">` and
   `<div class="opt-moo-1399">` before any JS runs (search-engine
   crawlers and "View source" both see this content now; before the
   migration they didn't).
2. No flash of the original page content before the variation appears
   — the variation is in the bytes from byte zero.
3. Click each FAQ question. The answer expands/collapses.
4. Click a tier card's tooltip-trigger checkbox. It opens. Click a
   different tier card's tooltip. The first closes.
5. Click anywhere off a tooltip. All tooltips close.
6. Click the "Expand all features" / "Collapse all features" button on
   the comparison table. The table grows/shrinks.
7. On `/hire/cs/pricing`, the customer's site header appears above the
   inserted pricing block. On other pages where the experiment runs
   (if any), the header stays in its original position.


Re-generating the HTML payload
------------------------------

If the source variation changes (new copy, updated pricing, new
tooltips), re-run:

```bash
cd decomposition-examples/indeed-pricing
node resolve.js
```

This re-resolves the template literals and rewrites
`change-1-insert-html.html`. Paste the new file's contents into
Change 1 in Optimizely.
