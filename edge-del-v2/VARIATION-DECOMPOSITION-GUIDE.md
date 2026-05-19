Variation Decomposition Guide — From JS-Heavy Variations to Edge Delivery
==========================================================================

**Audience.** Optimizely's Rapid Experimentation team (and other internal
authoring teams) preparing to migrate customer experiments from Performance
Edge to Edge Delivery. Once the pattern is internalised here, the same
material informs the customer-facing migration narrative.

**Purpose.** Walk through how a typical "complete page redesign" variation
authored as a single Custom Code block in Performance Edge decomposes into
a small set of Visual Editor changes (delivered at the CDN by Edge
Delivery) plus a minimal post-hydration behaviour shell. The end state
is a faster, more reliable variation that costs less to author for every
customer migration that follows.

**Status.** Internal draft. Walk through it manually on at least one
real variation before sharing with the team; refine based on what
breaks during that exercise.

**Companion docs in this kit.**

- `CUSTOMER-GUIDE.md` — the Edge Delivery + hydration reinforcement
  architecture this guide assumes is in place.
- `FINDINGS.md` — empirical hydration map (which change types Vue / React
  recover vs tolerate natively).
- `research-clientside-api.md` — Optimizely client-side JavaScript API
  reference, including the change-type vocabulary.


Contents
--------

1.  Why we are doing this
2.  The architectural insight — variations are mostly static
3.  The three-bucket decomposition pattern
4.  Identifying which bucket each piece of variation code belongs to
5.  Connecting to the hydration reinforcement layer
6.  Worked example — Sponsored Job plans pricing variation
7.  Authoring the decomposed variation in the Optimizely UI
8.  Validation checklist
9.  Performance characteristics — before vs after
10. Edge cases and when to escalate
11. Future tooling: the Variation Decomposer
12. Reference: bucket sort cheat sheet, change-type matrix, templates


1. Why we are doing this
------------------------

The legacy **Optimizely Performance Edge** is being deprecated. Customers
running on it have to migrate to **Optimizely Edge Delivery** (`@optimizely/
edge-delivery`, deployed via Cloudflare Workers). The two products share
much of the same datafile and change-type vocabulary, but they differ in
one consequential way:

  - Performance Edge runs JavaScript variations in the browser. The
    snippet downloads the variation code, evaluates it, and applies the
    changes client-side via DOM manipulation.
  - Edge Delivery applies variations at the CDN, via Cloudflare's
    HTMLRewriter, during the response stream. **JavaScript variation code
    does not execute at the edge.** Any JS in a variation is still
    shipped to the browser, but the work it does there is on top of the
    already-edge-applied HTML, not in place of it.

For variations that consist mostly of static content (text edits,
attribute edits, additive HTML, class changes, CSS), this difference is a
performance win. The content lands in the response bytes; the browser
paints it on the first frame.

For variations authored as large JavaScript-driven page redesigns —
common when the Rapid Experimentation team takes on customers who allow
substantial visual variants — the migration causes anxiety. The
variation code uses `waitForElement` polling, MutationObservers, large
inlined HTML strings, custom DOM manipulation, and the team worries that
moving to Edge Delivery "won't work" because the JavaScript can't run at
the edge.

**This anxiety is founded on a misread of what those variations
actually contain.** When you decompose a typical "page redesign" Custom
Code variation, the JS jacket is mostly a delivery mechanism for static
HTML+CSS plus a small interactive shell. The HTML+CSS belongs at the
edge. The interactive shell belongs in the browser. Today they are
fused into one JS blob because Performance Edge offered no other way to
ship them together; Edge Delivery's architecture allows — and rewards
— separating them.

This guide documents the separation pattern and walks through it
against a real variation from the existing customer program so the team
can practice on it before applying it across the customer's catalogue.


2. The architectural insight — variations are mostly static
-----------------------------------------------------------

Take a typical Custom Code variation that "redesigns a page." Strip out
the delivery scaffolding (the `waitForElement` polling, the
`modifyElementWithCallback` idempotency guards, the `insertAdjacentHTML`
mechanics) and you are left with three substantively different kinds of
material:

  - **Static content.** Large HTML and CSS strings that produce the
    same DOM for every visitor in the variation. Frequently 80–98% of
    the variation's byte size.
  - **Behaviour.** Event listeners, reactive state transitions
    (accordions, exclusive checkbox groups, tooltips, collapsible
    sections), interactive UI. Typically less than 1 KB.
  - **Conditional gating.** URL checks, audience-shaped filters
    written inline as `if (window.location.href.indexOf(...) > -1)` etc.
    Usually two or three lines.

The first kind is *what Edge Delivery is for*. The second kind is *what
client-side JavaScript is for*. The third kind belongs in Optimizely's
audience / URL-targeting configuration, not in inline JS.

Variations written for Performance Edge fuse all three into one Custom
Code blob because that was the only authoring surface available. Edge
Delivery has three authoring surfaces — Visual Editor changes (edge),
Custom Code (client), and audience / URL targeting (configuration) —
and each kind of material has a natural home in one of them.

The migration is a sort exercise.


3. The three-bucket decomposition pattern
-----------------------------------------

For every variation, sort each line of source code into one of three
buckets.

### 3.1 Bucket A — Edge-applicable changes

Anything that produces the same DOM for every visitor in the variation,
including:

  - Static HTML strings (template literals, even with constant
    interpolation like `${rightArrowSVG}`).
  - Inline `<style>` blocks. Keep them inside the inserted HTML, or
    split into Visual Editor **Custom CSS** changes for cleaner
    separation.
  - Class additions / removals / toggles on existing elements.
  - Attribute changes (`href`, `src`, `srcset`, `alt`, `data-*`).
  - Inline style attribute changes.
  - Element removal (the `hide` and `remove` sub-types under
    `attribute`).
  - Element rearrangement that is positional and selector-driven (the
    `rearrange` top-level change-type).

These all translate to Visual Editor changes. Edge Delivery applies them
via Cloudflare HTMLRewriter during the response stream. They are in the
HTML the browser receives. They cost zero client-side time.

### 3.2 Bucket B — Post-hydration behaviour shell

The minimum JavaScript necessary to make the edge-applied DOM
interactive, including:

  - Event listener wiring on the edge-applied elements (clicks, change,
    submit, focus, blur, keyboard events).
  - Reactive state transitions (accordion open/close, tab switching,
    modal open/close, dropdown toggle, exclusive checkbox / radio
    behaviour, tooltip show/hide).
  - Anything that responds to user input or document-level events.

These ship as a small Custom Code change at the experiment level, OR as
a `<script>` the Edge Delivery worker injects alongside the variation.
Either way, the byte size is a fraction of the original variation. The
shell runs *after* hydration, against the edge-applied DOM, with no
`waitForElement` polling because the elements it targets are guaranteed
present.

### 3.3 Bucket C — Delivery scaffolding that disappears

Code whose only purpose is to compensate for "JavaScript variation runs
before / around hydration." When the variation runs at the edge, this
code becomes unnecessary, including:

  - `waitForElement(selector)` polling for elements the edge inserted
    or that the SSR origin returns.
  - `modifyElementWithCallback` idempotency markers (e.g. the
    `.opt-1399-set` class). Edge-applied changes are applied once at
    request time; idempotency is the platform's responsibility, not
    the variation author's.
  - Custom URL-pattern parsing (`window.location.href.indexOf('/some/path')
    > -1`). Replaced by view URL targeting at the experiment level.
  - MutationObservers that re-apply changes on re-render — handled by
    the reinforcement layer described in `CUSTOMER-GUIDE.md`.
  - Audience / segment checks expressed inline as JS conditionals.
    Replaced by Optimizely audience definitions.

This bucket is pure win for the author: it is complexity they no longer
write or maintain.


4. Identifying which bucket each piece of variation code belongs to
-------------------------------------------------------------------

When walking through an existing variation, ask each line or block of
code the following questions in order:

  **Question 1 — does this produce DOM, or does it produce behaviour?**

  - If it produces DOM (an HTML string, a `setAttribute`, a
    `classList.add`, a `style.color = …`), proceed to Question 2.
  - If it produces behaviour (an `addEventListener`, a callback, a
    state transition), it is Bucket B.

  **Question 2 — does the DOM it produces depend on per-visitor
  signals?**

  - If the DOM is the same for every visitor matching the audience
    (typical for "redesign" variations — the HTML is constant), it is
    Bucket A.
  - If the DOM depends on `localStorage`, cookies the snippet doesn't
    have, `dataLayer` values, a client-side dataLayer push, or any
    other runtime-only signal, it stays in Bucket B (and needs to run
    client-side).

  **Question 3 — is this code only present to wait for, detect, or
  guard against an element that may not exist yet?**

  - If yes, it is Bucket C. Once the variation is decomposed, the
    underlying element is either present at SSR time (so no waiting
    needed) or present after the edge-applied insertion (so no waiting
    needed). The wait / guard disappears.

A practical observation: in most "redesign" variations the team
writes, the breakdown by lines of code roughly looks like —

| Bucket | Lines of code | Bytes |
|---|---|---|
| A (edge-applicable) | 5–15% | **80–98%** |
| B (behaviour) | 30–50% | 1–5% |
| C (scaffolding) | 40–60% | 1–10% |

Static content dominates by bytes; scaffolding dominates by lines of
code. Most of the author's time today is spent writing Bucket C
plumbing. Decomposition deletes that work.


5. Connecting to the hydration reinforcement layer
--------------------------------------------------

For customers running a hydrating framework (Vue / Nuxt, React / Next.js),
Bucket A's edge-applied content is at risk of being discarded by the
framework's hydration recovery pass. The kit's reinforcement layer
(documented in `CUSTOMER-GUIDE.md`) addresses this: a worker
post-processing pass extracts the SDK's `data-optly-<changeId>` markers,
emits an inline manifest, and an injected ~4 KB companion script
re-applies any edge-applied operations Vue or React undid during
recovery.

When migrating a variation to Edge Delivery for a SPA customer, the
reinforcement layer should be enabled at the worker level. With it in
place:

  - Bucket A's static HTML and class changes survive hydration. The
    companion re-inserts any unexpected children Vue's `v-for` discards
    or any reactive bindings React reverts.
  - Bucket B's behaviour shell runs *after* the companion's
    post-hydration replay. By the time the shell wires up event
    listeners, the edge-applied DOM is stable.
  - Bucket C's `waitForElement` polling is replaced by the companion's
    hydration-detection chain (`useNuxtApp().hook('app:mounted')` for
    Nuxt, the `edge-del-v2-hydrated` CustomEvent for Next.js, the
    generic `requestIdleCallback` fallback for everything else).

For customers on non-hydrating pages (vanilla server-rendered HTML, no
client-side framework), the reinforcement layer is unnecessary; the
edge-applied content stays put naturally and Bucket B can use the
existing snippet `lifecycle.activated` event as its hook.

In both cases, the decomposition pattern is the same. The reinforcement
layer is what makes it *safe* on SPA-heavy customers.


6. Worked example — Sponsored Job plans pricing variation
---------------------------------------------------------

The walked example below decomposes the variation at:

    Project:    19741965684
    Experiment: 6686084654956544
    Variation:  6298220561694720
    URL:        https://app.optimizely.com/v2/projects/19741965684/
                  experiments/6686084654956544/variations/6298220561694720

The variation source is approximately 30 KB of JavaScript whose primary
operation is to insert a complete "Sponsored Job plans" pricing
comparison section and an FAQ + supporting marketing sections into the
customer's `<main>` element on (and adjacent to) the pricing page.

### 6.1 What the variation actually does

Strip the Custom Code variation down to its substantive operations and
the list is:

1. Inject an inline `<style>` block that hides one of the customer's
   existing page sections by URL — `display:none` on
   `[data-tn-page="/hire/cs/pricing"] [data-tn-section=main]` and on
   the last child of `main` on every other URL. (CSS-conditional, not
   JS-conditional.)
2. Insert one large block of HTML at `main` position `afterbegin`. The
   block contains:
   - A pricing-tier comparison table (`_1445_contents`), ~18 KB.
   - An FAQ accordion section (`faqSection`), ~6 KB.
   - A "Hire more and faster" CTA section (`hireMoreSection`), ~2 KB.
   - An "Explore more with smart sourcing" section
     (`exploreMoreSection`), ~3 KB.
   - Inline `<style>` blocks for each section's component-scoped CSS.
3. Wire up the FAQ accordion's click-to-toggle behaviour.
4. Wire up the pricing comparison's checkbox-group exclusivity (one
   checkbox checked unchecks the others).
5. Wire up click-outside-to-close on tooltip popovers.
6. Wire up the "collapse / expand all features" toggle on the
   comparison table.
7. If the URL is `/hire/cs/pricing`, move the existing
   `[data-tn-section="header"]` element to *before* the inserted
   `.opt-moo-1399` block. (URL-conditional repositioning.)
8. Remove the `hasTransparentGnavBackground` class from any element
   that has it.

Around all of this, the variation uses `waitForElement('main')` to
ensure the customer's main element is in the DOM before any of the
above runs, and a `modifyElementWithCallback` idempotency guard with
the `.opt-1399-set` marker class to prevent double-application on SPA
re-renders.

### 6.2 Bucket sort

| # | Variation operation | Bucket | Notes |
|---|---|---|---|
| 1 | Inline `<style>` hiding existing page sections | **A** | Edge-applicable as a Custom CSS change, or kept inside the inserted HTML block. |
| 2 | Insert `_1445_contents` + `_1399_contents` at `main` afterbegin | **A** | Edge-applicable as a single Insert HTML change. The whole 30 KB lands in the response bytes. |
| 3 | FAQ accordion click-toggle | **B** | Behaviour. ~3 lines. |
| 4 | Checkbox-group exclusivity | **B** | Behaviour. ~10 lines. |
| 5 | Click-outside-to-close on tooltips | **B** | Behaviour. ~6 lines. |
| 6 | Comparison-table collapse toggle | **B** | Behaviour. ~3 lines. |
| 7 | URL-conditional header repositioning | **C** (becomes A) | The conditional disappears: pull `/hire/cs/pricing` up to URL targeting on a separate change (or a separate experiment) so the rearrange is unconditional within its scope. |
| 8 | Remove `hasTransparentGnavBackground` class | **A** | Edge-applicable as a Class change. |
| Scaffolding | `waitForElement('main')`, `modifyElementWithCallback`, `.opt-1399-set` markers | **C** | Disappears entirely. Edge-applied changes don't need to wait or guard. |

### 6.3 The decomposed variation — four changes

The variation becomes **four Visual Editor changes** plus the URL
targeting at the experiment level.

#### Change 1 (Bucket A) — Insert HTML at `main`

  - **Type.** Insert HTML.
  - **Selector.** `main` (the customer's primary content container).
    The previous selector via `waitForElement('main')` is replaced by
    this direct selector. HTMLRewriter targets it at request time.
  - **Position.** `afterbegin` (first child of `main`).
  - **HTML.** The combined contents of `_1445_contents` and
    `_1399_contents` from the source variation, **without** the
    surrounding JavaScript. Inline `<style>` blocks stay inline. The
    `${jobPostLink}` and `${rightArrowSVG}` template variables are
    resolved at authoring time and embedded as literals. Total size:
    ~30 KB of HTML+CSS.

  Authoring note: copy the rendered HTML the variation produces
  (after the JavaScript runs once, take `document.querySelector('main
  > #opt-1445').outerHTML + document.querySelector('main >
  .opt-moo-1399').outerHTML`) and paste that as the change's HTML
  value. This guarantees the byte-for-byte result of running the
  variation today, applied at the edge.

#### Change 2 (Bucket A) — Class change on `.hasTransparentGnavBackground`

  - **Type.** Attribute change with sub-key `class`.
  - **Selector.** `.hasTransparentGnavBackground`.
  - **Operation.** Remove class `hasTransparentGnavBackground`.

  This is a one-line change. The Visual Editor surfaces it as a class
  toggle.

#### Change 3 (Bucket A, was originally C) — Rearrange `[data-tn-section="header"]`

  - **Type.** Rearrange (top-level `rearrange` change type).
  - **Source selector.** `[data-tn-section="header"]`.
  - **Destination selector.** `.opt-moo-1399`.
  - **Position.** `before`.
  - **Audience condition.** URL contains `/hire/cs/pricing` (or
    matches that URL pattern exactly, depending on the customer's
    page structure).

  Crucially: the **URL conditional is pulled up to audience targeting**,
  not embedded as inline JavaScript. This is how the Optimizely platform
  is designed to express "this change applies only on these URLs."
  Inline `if (window.location.href.indexOf(...) > -1)` is an
  anti-pattern that the platform's audience system replaces.

  In practice this typically becomes a **second experiment** narrowly
  targeting the pricing-page URL, OR a separately-conditioned change
  within the same experiment using Optimizely's per-change audience
  targeting if the customer's plan supports it. For the Rapid
  Experimentation team's purposes either is fine; the second
  experiment is simpler to reason about and to deactivate independently
  if the change ever needs to be rolled back.

  If the customer's setup does not support `rearrange` at the edge
  (per `research-clientside-api.md` §5.5, rearrange on dynamic
  websites is officially unsupported by the client-side snippet, and
  the edge implementation has CSS-selector constraints), this change
  may need to remain as a small piece of Bucket B Custom Code. That's
  a known limitation; see §10.

#### Change 4 (Bucket B) — Custom Code behaviour shell

  - **Type.** Custom Code.
  - **Code.** The behaviour wiring that was previously bundled with
    the HTML payload, now standalone. The shell assumes the
    edge-applied DOM is already present when it runs.

  Concrete shell code (this is the entire Bucket B):

```javascript
(function () {
  // The edge-applied DOM is already present when this runs. No
  // waitForElement, no modifyElementWithCallback, no idempotency
  // marker class — the platform guarantees single-application of the
  // edge change for this experiment activation.

  // FAQ accordion — toggle .active on the question button when
  // clicked. The .active class controls both the chevron rotation
  // (via CSS) and the visibility of the .xds-faq-answer sibling.
  document.querySelectorAll('.opt-faq-section button.xds-faq-question-btn')
    .forEach((btn) => {
      btn.addEventListener('click', () => btn.classList.toggle('active'));
    });

  // Checkbox-group exclusivity — when any checkbox in the pricing /
  // FAQ scope is checked, all others uncheck. This implements the
  // tooltip/popover toggle behaviour the variation uses.
  const checkboxScope = () => document.querySelectorAll(
    '#opt-1445 input[type="checkbox"], #opt1399FAQ input[type="checkbox"]'
  );
  checkboxScope().forEach((cb) => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        checkboxScope().forEach((other) => {
          if (other !== cb) other.checked = false;
        });
      }
    });
  });

  // Click-outside-to-close — clicking anywhere outside a checkbox or
  // tooltip closes all open tooltips.
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest('input[type="checkbox"]') && !t.closest('.tooltip')) {
      checkboxScope().forEach((cb) => { cb.checked = false; });
    }
  });

  // Comparison-table collapse — toggle the .collapsed class on the
  // comparison container when the "expand/collapse features" button
  // is clicked.
  const collapseBtn = document.querySelector('button.collapse-feature');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      const comparison = document.querySelector('#opt-1445 .comparison');
      if (comparison) comparison.classList.toggle('collapsed');
    });
  }
})();
```

  Total: ~30 lines, well under 1 KB minified. Compare against the
  original variation's ~600 lines containing the HTML payload, the
  scaffolding, and the behaviour fused together.

### 6.4 What disappears

The decomposed variation contains **none of the following from the
original**:

  - `waitForElement` function definition (8 lines).
  - `modifyElementWithCallback` function definition (5 lines).
  - The `.opt-1399-set` marker class addition + recursive call (these
    were idempotency guards).
  - The `if (window.location.href.indexOf("/hire/cs/pricing") > -1)
    { … }` conditional and its inner `waitForElement` for
    `[data-tn-section="header"]` — replaced by Change 3's URL-targeted
    audience.
  - The `modifyElementWithCallback(".hasTransparentGnavBackground",
    …)` wrapper — replaced by Change 2's direct class change.

This is all Bucket C scaffolding that the platform now owns.


7. Authoring the decomposed variation in the Optimizely UI
----------------------------------------------------------

For each change, here is the step sequence in the Optimizely Visual
Editor. Assumes the team is authoring against a project that has Edge
Delivery enabled and the experiment has been created with the
appropriate URL targeting at the experiment level.

### 7.1 Create the experiment

  1. Project → Experiments → Create New Experiment.
  2. Name: `<customer-prefix> Pricing redesign — Sponsored Job plans`.
  3. URL targeting: the customer's pricing-page URL pattern (e.g.
     `https://*.indeed.com/hire/cs/pricing` and any related pages the
     variation should reach).
  4. Delivery mode: Edge Delivery (selecting the customer's
     Edge-Delivery-enabled snippet for the project).
  5. Audience: Everyone (or whatever audience the original
     Performance Edge experiment targeted).
  6. Save as draft.

### 7.2 Author Change 1 — Insert HTML at `main`

  1. In the Visual Editor preview, navigate to a page where the
     customer's `main` element is present (the pricing page works).
  2. In the change list, click **Add Change → Insert HTML**.
  3. Element selector: type or use the picker to select `main`. Verify
     the resolved selector is unambiguous — `main` is fine if the
     page has a single `<main>` element. If multiple, use a more
     specific selector like `main[data-tn-section="main"]` or
     `body > main`.
  4. Position: **Insert at start** (this is the Visual Editor's label
     for `afterbegin`).
  5. Source: select **HTML**.
  6. Paste the combined HTML of `_1445_contents` and `_1399_contents`
     from §6.3 Change 1.
  7. Verify the preview renders correctly. The pricing table, FAQ,
     "Hire more," and "Explore more" sections should appear at the
     top of `main`.

### 7.3 Author Change 2 — Class change on `.hasTransparentGnavBackground`

  1. **Add Change → Attribute**.
  2. Element selector: `.hasTransparentGnavBackground`. The Visual
     Editor may prompt for a specific element to anchor from; the
     `.hasTransparentGnavBackground` class typically appears on the
     header bar.
  3. Attribute: select **Class**.
  4. Operation: **Remove class**.
  5. Class name: `hasTransparentGnavBackground`.
  6. Verify in preview that the targeted element no longer has the
     class (typically the header background becomes opaque).

### 7.4 Author Change 3 — Rearrange `[data-tn-section="header"]`

  1. **Add Change → Rearrange**.
  2. Source element: `[data-tn-section="header"]`.
  3. Target element: `.opt-moo-1399` (which is now present in the
     page thanks to Change 1).
  4. Position: **Before**.

  Per-change URL targeting depends on the Visual Editor version
  available in your project's UI:

  - If the Visual Editor exposes a per-change URL condition:
    add a condition that the URL contains `/hire/cs/pricing` and save.
  - If not, this change must be moved to a separate experiment
    targeting only `/hire/cs/pricing`. Both experiments can share the
    customer's pricing-page snippet; the original experiment's URL
    targeting expands to include only the URLs where Change 3 should
    not fire.

  If your customer's CSS-selector engine at the edge does not
  support attribute selectors (this is rare; Cloudflare HTMLRewriter
  supports them), substitute the closest tag-based or class-based
  equivalent.

### 7.5 Author Change 4 — Custom Code (behaviour shell)

  1. **Add Change → Custom Code**.
  2. Synchronous Timing: **Asynchronous** (the shell should run after
     edge HTML application; asynchronous is correct here because the
     shell uses `addEventListener` and does not block render).
  3. Paste the shell from §6.3 Change 4.
  4. Save.

  When the customer is on a Vue / React SSR page and the reinforcement
  layer (`CUSTOMER-GUIDE.md`) is wired into the Edge Delivery worker,
  the shell will run after the companion's post-hydration replay
  completes. When the customer is on a non-hydrating page, the shell
  runs after the snippet's `lifecycle.activated` event. In both cases
  the edge-applied DOM is guaranteed present when the shell runs.

### 7.6 Save, publish, and verify

  1. Save all four changes.
  2. Publish the experiment (publish-to-snippet for Edge Delivery).
  3. Activate the experiment.
  4. Run through §8 validation.


8. Validation checklist
-----------------------

Before approving the migration for the customer's experiment, walk
through every box:

| # | Validation item | How to verify |
|---|---|---|
| 1 | The four changes apply correctly on first paint (SSR HTML contains the inserted block, the class removal, and the rearrange where applicable). | View source on the deployed page. Confirm `<div id="opt-1445">` and `<div class="opt-moo-1399">` are present in the HTML before any JS runs. Confirm `hasTransparentGnavBackground` is absent from the header element. |
| 2 | No flash of original content. | Open the page in a clean browser with cache disabled. Watch for any visible "before" state. There should be none. |
| 3 | FAQ accordion behaviour works. | Click each FAQ question. Confirm the answer expands / collapses. Confirm the chevron rotates. |
| 4 | Checkbox-group exclusivity works. | Click the info tooltip on one tier card. Click another tier card's tooltip. Confirm the first closes when the second opens. |
| 5 | Click-outside-to-close works. | Open a tooltip, click anywhere outside it. Confirm it closes. |
| 6 | Comparison-table collapse / expand works. | Click the "Expand all features" / "Collapse all features" button. Confirm the comparison table grows / shrinks. |
| 7 | URL-conditional header reposition (Change 3) applies only on `/hire/cs/pricing`. | Visit `/hire/cs/pricing` and confirm the header is above the inserted content. Visit a different page where the experiment runs and confirm the header is in its original position. |
| 8 | The variation does not duplicate-apply on SPA navigation. | If the customer's site uses client-side routing, navigate away from and back to the pricing page. Confirm only one instance of the inserted block is present (no `<div id="opt-1445">…<div id="opt-1445">…`). |
| 9 | Optimizely cookies and tracking still fire correctly. | Check that `optimizelyEndUserId`, the variation's `OPTY...VMAP`, and the experiment's conversion events still appear in the snippet's analytics pipeline. The decomposed variation should produce the same impression and conversion events as the original. |
| 10 | (SPA customers only) Hydration mismatch warnings are absent or limited to the static-content scope; the reinforcement layer logs are clean. | Open DevTools in development build. Confirm no `[Vue warn] hydration mismatch` warnings related to the inserted block. Confirm `window.__EDGE_DEL_V2__.events` shows a clean `boot:armed → hydration:<framework>-hook-armed → reapply:done` sequence. |
| 11 | Performance metrics improved. | Run Lighthouse or WebPageTest on the original Performance Edge variation and the decomposed Edge Delivery variation. LCP and FCP on the variant page should drop measurably (typical: 300–800 ms improvement). |
| 12 | Behavioural regressions absent. | Click through every interactive element on the page (links, buttons, dropdowns, the customer's own UI not covered by the variation). Confirm nothing else has broken. |


9. Performance characteristics — before vs after
-------------------------------------------------

Order-of-magnitude expectations for a variation of the shape in §6,
on a customer site that uses Vue / Nuxt SSR with hydration:

### 9.1 Before (Performance Edge, fused JS variation)

  - Snippet load (~91 KB, blocking): ~50–200 ms depending on cache
    state.
  - `waitForElement('main')` polling: 0–250 ms depending on when the
    customer's framework mounts `<main>`.
  - HTML parse + insert of the 30 KB variation block: ~10–30 ms.
  - Re-layout / re-paint: ~20–80 ms.
  - **Visible variation content appears: ~80–500 ms after snippet
    load.**
  - LCP impact: the LCP element on the original page is replaced /
    moved by the variation; LCP timing reflects when the variation
    block paints. Typically 300–800 ms later than the page's
    underlying LCP.
  - Hydration impact: variation content may be discarded by Vue's
    recovery pass, causing a flicker / re-render cycle.
  - SEO: search-engine crawlers see the original content, not the
    variation. The experiment's content is invisible to indexing.

### 9.2 After (Edge Delivery, decomposed)

  - Snippet load (still ~91 KB, still tracking + analytics): same
    latency as before. **But variation content is independent of
    snippet load.**
  - Variation content (30 KB HTML+CSS): in the SSR response bytes.
    Visible on first paint, no waiting.
  - Re-layout / re-paint of inserted content: none — it's part of the
    initial layout pass, not a post-load mutation.
  - **Visible variation content appears: at first paint, ~0 ms
    relative to the page.**
  - LCP impact: the LCP element is whatever the variation block
    designates (the pricing table headline, typically). LCP timing
    reflects only the page's own SSR + paint pipeline.
  - Hydration impact: with the reinforcement layer in place (see
    `CUSTOMER-GUIDE.md`), the companion re-applies any operations Vue
    discards within ~50 ms after `app:mounted`. With it absent, the
    static template content typically survives hydration anyway (per
    `FINDINGS.md` §3); the additive content is the case where the
    companion is load-bearing.
  - SEO: search-engine crawlers see the variation content as part of
    the page. The experiment becomes indexable. (This is a material
    win for content-heavy experiments that customer SEO teams have
    historically forbidden Optimizely from running.)
  - Behaviour shell: ~1 KB minified, runs after hydration, adds
    interactive behaviour with no measurable performance cost.

### 9.3 Typical real-world deltas

For a typical SPA customer with a desktop-class device:

  - **LCP:** −400 to −800 ms.
  - **FCP:** −200 to −400 ms.
  - **CLS:** −0.05 to −0.15 (no late-arriving variation content
    shifting layout).
  - **Total Blocking Time:** marginally improved (less JS work on
    main thread post-load).
  - **Bytes shipped:** roughly unchanged (the 30 KB is now in the
    HTML response instead of in a JS string, but it's the same 30 KB).

For mobile / low-end devices the absolute improvements are larger
because polling intervals and parse times scale unfavourably on
weaker hardware.


10. Edge cases and when to escalate
------------------------------------

Some variation shapes do not decompose cleanly. When you encounter
one, escalate to the team lead rather than forcing a poor
decomposition.

### 10.1 Per-visitor dynamic content

If the variation's HTML genuinely varies per visitor based on
client-side signals (`localStorage`, `dataLayer`, a third-party tag's
output, a user-segment cookie set by JS), the per-visitor portion
must stay in Bucket B (Custom Code) and run client-side. Decompose as
follows:

  - The variation's static skeleton goes to Bucket A as Insert HTML.
  - The dynamic content (e.g. personalised product names, recent
    search results) is fetched / computed by the behaviour shell and
    inserted into the static skeleton's placeholder elements after
    hydration.

This pattern preserves the edge-delivery win for the bulk of the
content while keeping the dynamic part on the client.

### 10.2 Rearrange / move on dynamic websites

Per `research-clientside-api.md` §5.5, Optimizely's official
documentation states that **rearrange tests are not supported on
dynamic websites** at the standard snippet level. The Edge Delivery
SDK supports rearrange via HTMLRewriter (subject to CSS-selector
limitations on the edge runtime — Cloudflare HTMLRewriter does not
support sibling combinators or pseudo-elements). For decomposition
purposes:

  - **If the source and destination elements are stable in the SSR
    HTML**, use a Visual Editor Rearrange change (Bucket A).
  - **If either is generated by a client-side framework**, the
    rearrange must stay in Bucket B as a small piece of Custom Code
    that runs after hydration.

The Change 3 in §6.3 falls into the first case: both the source
header and the destination `.opt-moo-1399` exist at HTMLRewriter time
(the destination because Change 1 inserts it; the source because
it's part of the customer's SSR HTML).

### 10.3 Custom Code changes that cannot be decomposed

Some legitimately need to be Custom Code: third-party A/B test
coordination, complex form validation, animation choreography,
analytics integrations. These stay in Bucket B and the decomposition
output for that experiment includes a non-trivial Custom Code block.
The win is still real — the static portion goes to the edge — but
the JavaScript footprint doesn't shrink to a small shell.

### 10.4 Customers without the reinforcement layer wired up

If the customer's Edge Delivery worker does not yet have the
reinforcement layer described in `CUSTOMER-GUIDE.md`, decomposed
variations with additive DOM into v-for parents (Vue) or unkeyed
mapped lists (React) will see Vue / React discard the inserted
content during hydration. Bucket A's static content is *not safe*
in this case until the reinforcement layer is in place.

For these customers: defer migration of variations with additive
DOM into hydrated regions until the reinforcement layer ships. In
the meantime, decompose only variations that touch text / attribute
/ class on existing elements (which survive hydration natively per
`FINDINGS.md`).

### 10.5 Performance Edge custom JavaScript that cannot be reverted

Per `research-clientside-api.md` §5.5, Optimizely Performance Edge
**cannot revert custom JavaScript on deactivation**. This is an
inherited platform limitation. When migrating away from Performance
Edge, examine whether the original variation's Custom Code performs
any irreversible side effects (e.g. setting cookies, mutating
`localStorage`, calling third-party endpoints). If so, the
decomposed version's Custom Code should preserve the same
irreversibility scope — don't accidentally make it reversible if the
customer's existing analytics or tracking depends on the
non-revert behaviour.


11. Future tooling: the Variation Decomposer
---------------------------------------------

Manual decomposition is realistic per-variation but becomes onerous
when migrating dozens at a time. The kit proposes an internal
Optimizely tool that automates the bucket sort.

### 11.1 What the tool does

Input: a Performance Edge variation source file (the JavaScript blob).

Output:
  - A JSON manifest of Visual Editor changes (Bucket A operations
    parsed out of the source).
  - A trimmed Custom Code file (Bucket B operations).
  - A flagged-issues report (Bucket C scaffolding that was removed
    plus anything the tool couldn't classify).

### 11.2 How it works

  1. Parse the JavaScript with a standard ESTree parser
     (`acorn` / `espree`).
  2. Walk the AST. For each top-level statement and each callback
     body:
       - String literals that are HTML / CSS → candidates for Insert
         HTML or Custom CSS changes. The tool concatenates template
         literals with their interpolated values (which are constants
         at authoring time, e.g. `${rightArrowSVG}`) and emits the
         resolved string.
       - `setAttribute(name, value)` / `removeAttribute(name)` /
         `classList.add(class)` / `classList.remove(class)` /
         `style.<prop> = value` → emit corresponding Visual Editor
         attribute / class / style changes.
       - `insertAdjacentHTML(position, html)` / `appendChild(node)` /
         `prepend(node)` / `before(node)` / `after(node)` →
         emit Insert HTML changes at the corresponding position.
       - `addEventListener` / `removeEventListener` / event handler
         assignments → keep in the Bucket B output.
       - `waitForElement` / `modifyElementWithCallback` / similar
         polling functions → unwrap their callbacks and reclassify
         the inner operations.
       - `window.location.href` / `document.URL` conditionals →
         flag for the author to pull up to URL targeting; do not
         attempt to translate automatically.
  3. Idempotency-marker class additions (e.g. `.opt-1399-set`) →
     drop entirely. Edge Delivery handles single-application at the
     platform level.
  4. Output the manifest + Custom Code + issues report.

### 11.3 Where this would live

  - Internal Optimizely tooling repository.
  - Run as `npx @optimizely/variation-decompose <path-to-variation.js>`.
  - Output a `decomposed/` directory with:
    ```
    decomposed/
    ├── changes.json        # Visual Editor change manifest
    ├── custom-code.js      # Trimmed behaviour shell
    └── decomposition.md    # Issues, flagged conditionals, recommendations
    ```
  - The Rapid Experimentation team runs the tool, reviews the output,
    and pastes the changes into the Visual Editor. Adjustments for
    edge cases (§10) happen at review time.

### 11.4 Why this is worth building

Per-customer migration estimate for the Rapid Experimentation team
today: a senior engineer takes 4–8 hours per variation to manually
decompose. Across a customer with 50+ variations to migrate, that's
1–2 engineer-weeks per customer.

With the Decomposer: the tool produces a first-pass decomposition in
seconds; the engineer reviews and adjusts in 30–60 minutes per
variation. Reduces engineering time per customer by ~75%.


12. Reference
--------------

### 12.1 Bucket-sort cheat sheet

| Pattern in source code | Bucket | Decomposed form |
|---|---|---|
| Template literal HTML (`` ` `` … `` ` ``) | A | Insert HTML change |
| `<style>` block inside an inserted HTML string | A | Keep inline, OR split into Custom CSS change |
| `classList.add(X)` on an existing element | A | Class change |
| `classList.remove(X)` on an existing element | A | Class change |
| `setAttribute(name, value)` on an existing element | A | Attribute change |
| `element.style.<prop> = value` | A | Attribute change with sub-key `style` |
| `element.remove()` on an existing element | A | Attribute change with sub-key `remove` |
| `insertAdjacentHTML('beforebegin' / 'afterbegin' / 'beforeend' / 'afterend', …)` | A | Insert HTML change with the corresponding position |
| `appendChild(node)` / `prepend(node)` | A | Insert HTML change with `append` / `prepend` |
| `parent.insertBefore(node, ref)` | A | Insert HTML change with `before` |
| `addEventListener('click', …)` | B | Custom Code |
| `addEventListener('change', …)` | B | Custom Code |
| State transitions (toggle, open/close, show/hide) | B | Custom Code |
| `waitForElement(selector)` | C | Disappears (selector is now applied at edge) |
| `modifyElementWithCallback(...)` with marker class | C | Disappears (platform handles idempotency) |
| `if (window.location.href.indexOf(...) > -1)` | C → A | Pull up to URL targeting / audience |
| `if (document.cookie.match(/X=/))` | B | Custom Code (client-side signal) |
| MutationObserver | C (usually) → A | Disappears if the wait was for an edge-applied element; otherwise stays in Bucket B |

### 12.2 Optimizely change-type mapping

(Lifted from `CUSTOMER-GUIDE.md` §7.4 and `research-clientside-api.md`
§5; reproduced here for the team's quick reference during
decomposition.)

| Operation                                  | Top-level `change.type` | Sub-key on `change.attributes` |
|--------------------------------------------|-------------------------|--------------------------------|
| Set text content                           | `attribute`             | `text`                         |
| Replace innerHTML                          | `attribute`             | `html`                         |
| Set class list                             | `attribute`             | `class`                        |
| Set href                                   | `attribute`             | `href`                         |
| Set src                                    | `attribute`             | `src`                          |
| Set srcset                                 | `attribute`             | `srcset`                       |
| Set inline style                           | `attribute`             | `style`                        |
| Hide via `display:none`                    | `attribute`             | `hide`                         |
| Remove element                             | `attribute`             | `remove`                       |
| Insert HTML (append / prepend / etc.)      | `append`                | (uses `value` for HTML)        |
| Move element relative to another           | `rearrange`             | (uses `src` and `dest`)        |
| Redirect browser to another URL            | `redirect`              | (uses `dest`)                  |
| Insert Optimizely widget                   | `widget`                | (uses widget-specific config)  |
| Run arbitrary JavaScript                   | `custom_code`           | (uses `value` for code)        |

### 12.3 Decomposition template (per-variation worksheet)

For each variation being migrated, fill in:

```
Experiment ID:       ____________
Variation ID:        ____________
Customer:            ____________
Original variation size (bytes):  ____________

Bucket A — Edge-applicable changes:
  Change 1:   Insert HTML at  __________  position  __________
              HTML size: ___ KB
  Change 2:   Class change   on  __________   add: ____  remove: ____
  Change 3:   Attribute change on  __________  attr: ____  value: ____
  Change 4:   Rearrange  src: __________  dest: __________  position: ____
  …

Bucket B — Post-hydration behaviour shell (Custom Code):
  Lines:                  ____
  Operations:             ____
  Dependencies on B:      ____ (event listeners, state transitions, dynamic data)

Bucket C — Scaffolding removed:
  waitForElement calls:           ____
  modifyElementWithCallback calls:____
  URL conditionals pulled up:     ____ (note new audience / targeting needed)
  MutationObservers removed:      ____
  Idempotency markers dropped:    ____

URL targeting:           ____________  (the experiment's URL match)
Audience:                ____________  (the experiment's audience)
Reinforcement required:  ____________  (yes if customer is on Vue / React SSR)
```

### 12.4 Files in this kit relevant to the team

  - `CUSTOMER-GUIDE.md` — the Edge Delivery + reinforcement architecture.
  - `FINDINGS.md` — empirical hydration map.
  - `research-clientside-api.md` — Optimizely JavaScript API reference.
  - `VARIATION-DECOMPOSITION-GUIDE.md` — this document.
  - `customer-email.md` — customer-facing summary email for handoffs.

### 12.5 Live lab for testing decomposed variations

The reinforcement-layer lab at `https://edge-del-v2-target.pages.dev/`
can be used to test a decomposed variation against a real Vue 3 / Nuxt 3
SSR target before applying it to the customer's production site. Author
the same Optimizely changes against a test snippet pointed at the lab,
verify the hydration behaviour, then port the changes to the customer's
production snippet.

---

End of document. Walk this through against one variation end-to-end
before sharing with the team; report back anything that breaks the
pattern or surfaces unexpected complexity.
