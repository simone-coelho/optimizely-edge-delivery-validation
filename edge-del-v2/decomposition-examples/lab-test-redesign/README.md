Lab test — Decomposition pattern, full four-change variation
============================================================

**Purpose.** Validate end-to-end (edge application + hydration + Custom
Code wiring) that the four-change decomposition pattern works on our
existing Edge Delivery lab before recommending it to the Indeed Rapid
Experimentation team.

**Reuses.** The deployed lab at `https://edge-del-v2-target.pages.dev/`
(Nuxt 3 / Vue 3.5 SSR + Pages-integrated worker + reinforcement
companion). The Optimizely test project `5953372780494848`
(account `8543082612`) that already hosts the "Labco HP" banner
experiment.

**What this test exercises that the existing Labco HP experiment does
not.**

| Capability | Labco HP (existing) | This test |
|---|---|---|
| Single `append` change at the edge | ✓ | ✓ |
| Multiple changes in one variation | — | ✓ (four) |
| Class change at the edge | — | ✓ |
| Rearrange change at the edge | — | ✓ |
| Custom Code wiring on edge-applied DOM | — | ✓ |
| Interactive behaviour (accordion) on edge-applied content | — | ✓ |


Authoring in Optimizely UI
---------------------------

In project `5953372780494848`, create a **new experiment** (don't modify
Labco HP — keep it as the simple-banner regression case).

### Experiment-level settings

| Field | Value |
|---|---|
| Name | `Lab — Decomposition pattern test` |
| Type | A/B (single variation against Original) |
| URL targeting | Match type: Simple; URL: `https://edge-del-v2-target.pages.dev/pricing` |
| Audience | Everyone |
| Traffic | 100% to Variation #1 (skip Original / 0% control) |
| Delivery mode | Edge Delivery (same snippet as Labco HP) |

**Why `/pricing` and not `/`:** the existing Labco HP experiment runs
at 100% on the home page (URL `https://edge-del-v2-target.pages.dev/`).
If we target the same URL the two experiments would both apply (they
live in separate Optimizely layers, both at 100%, so they stack rather
than mutually exclude), making the test outcome unclean. The
`/pricing` page is structurally the closest match to a real pricing
redesign target — it has an h1, lead text, the PricingCards component,
and a banner anchor — so the test is both isolated and representative.

### The four changes

For each change below, the table shows the manifest-level fields
(what the change object will look like in the Optimizely datafile) and
the Visual Editor walkthrough (the click-by-click action sequence in
the UI). Both descriptions refer to the same change — manifest is
what the SDK consumes; Visual Editor is how a human authors it.

#### Change 1 — Insert HTML

**Manifest:**

| Field | Value |
|---|---|
| `change.type` | `append` |
| `change.selector` | `main` |
| Insertion position | first child (the Visual Editor labels this "Insert at start" or "Prepend"; the manifest stores it under the `append` type with an internal position field) |
| `change.value` | The full contents of `change-1-insert-html.html` in this folder |

**Authoring in the Visual Editor:**

1. Open the experiment's variation in the Visual Editor.
2. Navigate the preview to `https://edge-del-v2-target.pages.dev/pricing`.
3. Click anywhere on the `<main>` element to select it. The editor
   highlights the element and opens its right-panel actions.
4. From the editor's toolbar (or right-click menu on the selected
   element), choose **Insert HTML** (the menu item may also be labeled
   "Insert Element" depending on the Visual Editor version).
5. In the position picker, choose **Insert at start** (the option
   that places the new element as the first child of the selection,
   i.e. the `afterbegin` DOM insertion position).
6. Paste the contents of `change-1-insert-html.html` (open the file
   in any text editor, select all, copy) into the HTML input.
7. Save.

The inserted block contains a pricing-tier preview, a 4-item FAQ
accordion, and inline CSS for both. ~6.9 KB. The `<style>` block at
the top of the HTML defines a rule that styles `#pricing-page-title.optly-redesign`
— that rule fires when Change 2 applies the class. It's how the team
visually verifies Change 2 worked.

#### Change 2 — Set the `class` attribute on the page heading

This is the change that I previously mis-labeled "Add class." In
Optimizely's data model there is no add-class delta operation; class
changes are expressed as **setting the full value of the element's
`class` attribute**. The change is stored as `change.type = "attribute"`
with `change.attributes.class = "<new class value>"`. The Visual
Editor surfaces this through its **Edit Attributes** action (some
versions also expose a dedicated **Classes** field that internally
writes the same attribute).

**Manifest:**

| Field | Value |
|---|---|
| `change.type` | `attribute` |
| `change.selector` | `#pricing-page-title` |
| `change.attributes.class` | `optly-redesign` |

The element on `/pricing` is `<h1 id="pricing-page-title">Pricing</h1>`
— it currently has no `class` attribute. Setting class to
`optly-redesign` leaves the element as `<h1 id="pricing-page-title" class="optly-redesign">Pricing</h1>`.

If the element ALREADY had classes you wanted to preserve, the value
field would need to include them too (e.g. `existing-class optly-redesign`)
— Optimizely class changes set the full attribute, they do not
union with the element's existing classes. For our test case the
element has no existing class, so the value is just `optly-redesign`.

**Authoring in the Visual Editor:**

1. With the variation still open, click on the `<h1>` element on the
   `/pricing` preview (the text "Pricing" at the top of the page).
2. From the toolbar / right-panel, choose **Edit Attributes** (some
   versions show this as a key/value editor; some show class as its
   own field separately from generic attributes).
3. In the `class` attribute field (or the dedicated Class field if
   one is exposed), enter the value: `optly-redesign`
4. Save.

If your Visual Editor version exposes a "Class" tab with add/remove
controls instead of a raw attribute editor, the same effect is achieved
by adding `optly-redesign` there — the editor will internally write
the class attribute and you get the same manifest output.

#### Change 3 — Move element (rearrange) — lead paragraph after pricing cards

In Optimizely's data model this is `change.type = "rearrange"`. The
Visual Editor surfaces it through a **Move Element** action (older
docs and UI versions also use the label **Rearrange**). Both names
refer to the same change-type.

**Manifest:**

| Field | Value |
|---|---|
| `change.type` | `rearrange` |
| Source `change.src` | `#pricing-page-lead` |
| Destination `change.dest` | `[data-edge-region="pricing-cards"]` |
| Position relative to destination | After |

**Authoring in the Visual Editor:**

1. Click on the lead paragraph (`<p id="pricing-page-lead">Simple
   plans for every team size.</p>`).
2. From the toolbar / right-panel, choose **Move Element** (or
   **Rearrange** in older Visual Editor versions).
3. The editor prompts you to choose a target element. Click on the
   pricing-cards container — the `<div class="cards" data-edge-region="pricing-cards">`
   that wraps the three plan cards.
4. Choose the position **After** (places the moved element as the
   next sibling of the target, immediately after the target's closing
   tag).
5. Save.

The combined effect of Changes 1+2+3 produces the page order:

```
header
main
└── .page-pricing wrapper
    ├── (Change 1) #lab-redesign block — pricing preview + FAQ
    ├── (existing) <h1 id="pricing-page-title"> — with optly-redesign
    │              class from Change 2 (blue eyebrow above it)
    ├── (existing) Plans section — PricingCards
    ├── (Change 3 moves lead here) <p id="pricing-page-lead">
    └── (existing) banner-anchor section
footer
```

The lead paragraph is the rearrange test target because it's a
keyed sibling of the pricing-cards inside the same Vue component.
Vue's hydrator will want to put `#pricing-page-lead` back in its
template-defined position (before the cards); the companion's
post-hydration replay is what holds the rearrange in place. This is
the case where the reinforcement layer earns its keep.

#### Change 4 — Custom Code (FAQ accordion wiring)

In Optimizely's data model this is `change.type = "custom_code"`.
The Visual Editor surfaces it through a **Custom Code** or **Edit Code**
action, opening a JavaScript editor inside the variation.

**Manifest:**

| Field | Value |
|---|---|
| `change.type` | `custom_code` |
| `change.value` | The full contents of `change-4-custom-code.js` |
| Synchronous Timing | Asynchronous |

**Authoring in the Visual Editor:**

1. From the experiment's variation editor, open the **Edit Code**
   pane (sometimes shown as a side tab labelled "Custom Code" or as
   a top-level toolbar action; depends on Visual Editor version).
2. Set **Synchronous Timing** to **Asynchronous**. The shell uses
   `addEventListener`, doesn't block render, and runs after the
   edge-applied HTML is in the DOM — asynchronous is correct.
3. Paste the contents of `change-4-custom-code.js` into the editor.
4. Save.


Validation — verify each change before sign-off
------------------------------------------------

After publishing and starting the experiment, run through every item.
You can do the curl checks from a terminal and the browser checks
from any clean browser.

### Phase 1 — Edge-applied changes are in the SSR response

Cold curl against the deployed lab:

```bash
WORKER=https://edge-del-v2-target.pages.dev
curl -sL -A "Mozilla/5.0" "$WORKER/pricing?reinforce=on&t=$(date +%s)" -o /tmp/page.html

# Change 1: inserted block present
grep -c 'id="lab-redesign"' /tmp/page.html
# expected: 1

# Change 2: optly-redesign class added to the h1
grep -oE '<h1[^>]*id="pricing-page-title"[^>]*>' /tmp/page.html | head -1
# expected output contains: class="optly-redesign" (alone or alongside other classes)

# Change 3: lead paragraph now appears after pricing-cards in DOM order
python3 -c "
html = open('/tmp/page.html').read()
lead = html.find('id=\"pricing-page-lead\"')
pricing = html.find('data-edge-region=\"pricing-cards\"')
print('lead offset:', lead, 'pricing offset:', pricing)
print('rearrange applied:', lead > pricing)
"
# expected: rearrange applied: True

# Variation bucketing — visitor got into Variation #1
curl -sL -A "Mozilla/5.0" -D - "$WORKER/pricing?reinforce=on&t=$(date +%s)" -o /dev/null 2>&1 | grep -oE 'VMAP=[^;]+'
# expected: VMAP=<layerId>_<experimentId>_<variation #1 id>
```

### Phase 2 — Hydration survival (the reinforcement layer's job)

Open `https://edge-del-v2-target.pages.dev/pricing?reinforce=on` in a
browser (Chromium-based; Vue dev tools optional).

Visual checks:
1. The `#lab-redesign` block appears at the top of `<main>`. Pricing
   preview + FAQ visible.
2. The page's existing `<h1>Pricing</h1>` has a blue top-border and
   "DECOMPOSITION PATTERN TEST — REDESIGN VARIANT" eyebrow text above
   it. (This proves Changes 1 and 2 applied and survived hydration.)
3. The lead paragraph "Simple plans for every team size." appears
   *below* the pricing cards rather than above them. (This proves
   Change 3's rearrange survived hydration via the reinforcement layer.)
4. No flash of original content. No FAQ items appearing and
   disappearing.
5. No `[Vue warn]` messages in DevTools console (production build is
   silent; if you switch to a dev build temporarily, expect zero
   hydration warnings related to the lab-redesign subtree).

DevTools inspection:
```
document.getElementById('lab-redesign')                              // not null
document.getElementById('pricing-page-title').classList              // includes "optly-redesign"
Array.from(document.querySelector('.page-pricing').children).map(c =>
  c.id || c.getAttribute('data-edge-region') || c.getAttribute('data-edge-anchor') || c.tagName.toLowerCase())
// expected order (with reinforce=on):
// ['lab-redesign', 'pricing-page-title', 'pricing-cards', 'pricing-page-lead', 'pricing-banner']
```

Companion telemetry:
```
window.__EDGE_DEL_V2__.events.map(e => e.detail?.kind || e.kind)
// expected:
// ['boot:armed', 'hydration:nuxt-hook-armed', 'reapply:done']
```

### Phase 3 — Custom Code wired up correctly

Click each FAQ question (`#lab-faq-0` through `#lab-faq-3`). Each
answer should expand below the question and collapse on second click.
Confirm the `lab-active` class toggles on the button.

DevTools:
```
document.querySelectorAll('#lab-redesign .lab-faq-question.lab-wired-up').length
// expected: 4 (all four buttons received their click handler)
```

### Phase 4 — Compare against reinforce=off

Visit `https://edge-del-v2-target.pages.dev/pricing?reinforce=off` and
confirm what changes:

- `#lab-redesign` block still present (Change 1 lands at the edge
  unconditionally — it's into `main` afterbegin and main is not a
  v-for, so Vue tolerates the unexpected child).
- `optly-redesign` class on `#pricing-page-title` — still present if
  it survived natively; the existing case 02/03 data suggests
  static-template class additions on existing elements survive
  natively in production builds, so probably present.
- Lead-paragraph position after pricing cards — depends on whether
  Vue's hydrator preserves the moved DOM order or reconciles back to
  the `.page-pricing` template's order. Most likely Vue snaps the
  lead back to its template-defined position above the cards.
  **This is where the reinforcement layer earns its keep.**
- Custom Code still wires up the accordion (the inserted block is in
  the DOM; Custom Code is a separate Optimizely-managed JS change
  that runs independently of the reinforcement flag).

If Phase 4 shows the rearrange reverting without reinforcement, that's
the textbook validation of the reinforcement layer's value: for
structural reorder, the companion is the load-bearing piece.


Running the existing Playwright harness against this
-----------------------------------------------------

The harness at `harness/run.ts` can be extended to cover this. The
fastest path is to add the test as an explicit one-off scenario rather
than a generic case in `experiments/`:

```bash
cd harness
cat > verify-lab-test.mjs <<'EOF'
import { chromium } from 'playwright';
const URL = 'https://edge-del-v2-target.pages.dev/pricing';
const browser = await chromium.launch({ headless: true });

for (const variant of ['off', 'on']) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL + '?reinforce=' + variant + '&t=' + Date.now(),
                  { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => {
    const lab = document.getElementById('lab-redesign');
    const h1 = document.getElementById('pricing-page-title');
    const lead = document.getElementById('pricing-page-lead');
    const pricing = document.querySelector('[data-edge-region="pricing-cards"]');
    const pageRoot = document.querySelector('.page-pricing') || document.querySelector('main');
    const order = Array.from(pageRoot.children)
      .map(c => c.id ||
                c.getAttribute('data-edge-region') ||
                c.getAttribute('data-edge-anchor') ||
                c.tagName.toLowerCase());
    return {
      labBlock: !!lab,
      h1HasClass: h1?.classList.contains('optly-redesign'),
      pageChildOrder: order,
      leadAfterPricing:
        order.indexOf('pricing-page-lead') > order.indexOf('pricing-cards'),
      faqButtonsWired: document.querySelectorAll(
        '#lab-redesign .lab-faq-question.lab-wired-up').length
    };
  });
  console.log(`reinforce=${variant}:`, JSON.stringify(state, null, 2));
  await ctx.close();
}
await browser.close();
EOF
npx tsx verify-lab-test.mjs
```

Expected output:

```
reinforce=on:  labBlock=true, h1HasClass=true, leadAfterPricing=true,  faqButtonsWired=4
reinforce=off: labBlock=true, h1HasClass=<probably true>,
               leadAfterPricing=<probably false>, faqButtonsWired=4
```

The interesting line is `leadAfterPricing` — that's where the
reinforcement layer's value shows up for structural rearrange changes.
With reinforcement on, the companion re-applies the move after Vue's
hydration; with it off, Vue snaps the lead back to its
template-defined position above the cards.


What success looks like before recommending to Indeed
-----------------------------------------------------

All four changes apply at the edge, are visible at first paint, and
survive hydration with the reinforcement layer enabled. The Custom
Code wires up the accordion against the edge-applied DOM with no
waitForElement scaffolding. The reinforce=off comparison demonstrates
the layer's contribution for the structural change.

When that picture is clean, we have empirical evidence the
decomposition pattern is safe to recommend for variations of the
Indeed pricing shape.
