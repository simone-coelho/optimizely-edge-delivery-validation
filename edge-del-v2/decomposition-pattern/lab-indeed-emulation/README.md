# Lab Indeed Emulation — runnable proof of the four-change decomposition

> Open this in a browser and you are looking at Indeed's literal
> /hire/cs/pricing variation, served through our lab's edge worker,
> hydrated by Vue 3.5, kept alive across SPA navigation by the
> companion. Everything below explains how to reproduce it.

**Live URL** — <https://edge-del-v2-target.pages.dev/hire/cs/pricing>

**Manifest** — `https://cdn.optimizely.com/js/web_sdk_v0_5953372780494848.json`,
layer name *"Indeed Pattern — Lab Emulation"*

**Training screenshots** — `screenshot-*.png` in this folder; one
cold-load and one after-SPA-roundtrip per mode (see *Training the
engineers* below).

## Training the engineers — three modes on the same URL

The same URL renders in three modes via query parameters. Open all
three side-by-side in three browser tabs while explaining what edge
delivery does and what the reinforcement layer is for. Read the
`x-edge-del-v2` response header in DevTools → Network to confirm
which mode you are in.

| Mode | URL | What the page shows | Where it matters |
| ---- | --- | ------------------- | ---------------- |
| **1 — Control**       | `/hire/cs/pricing?variation=off` | The Nuxt placeholder: *"Hire on Lab Co."*, no Indeed content. The worker skips `applyExperiments()` entirely. | This is what the page would look like with no experiment running. Customers see this if their VMAP cookie is empty (audience miss, holdback). |
| **2 — Variation, no companion** | `/hire/cs/pricing?reinforce=off` | Cold load: full Indeed pricing page (54 KB variation rendered at the edge, visible at first paint). After SPA navigation away and back: **placeholder, variation gone**. | This is the customer pain point. Edge Delivery delivered the variation in the SSR bytes, but the moment Nuxt's client-side router mounts a fresh copy of the page, the variation isn't there — the SPA navigation doesn't re-hit the edge worker. |
| **3 — Variation + companion** | `/hire/cs/pricing` (no flags) | Cold load: full Indeed pricing page. After SPA navigation away and back: **still full Indeed pricing page**. The companion replays the manifest from `app:mounted` and from every history-API call. | The production target. What the reinforcement layer makes possible. |

The visual contrast you want to show is **screenshot-2-…-cold.png
vs screenshot-2-…-after-spa-roundtrip.png** — same mode, same URL, but
the variation disappears the moment Nuxt's router re-mounts the page.
Then **screenshot-3-…-after-spa-roundtrip.png** to show what the
companion does about it.

The cold-load screenshots (`-cold.png`) for modes 2 and 3 are nearly
identical, intentionally — initial hydration is *not* the failure mode
on a well-structured single-`<main>` page like this lab. Vue keeps the
SSR variation alongside the placeholder. The companion is needed for
SPA, not for hydration.

A quick demo script for a 15-minute walkthrough:

```text
1.  Open three browser tabs:
       Tab A:  /hire/cs/pricing?variation=off
       Tab B:  /hire/cs/pricing?reinforce=off
       Tab C:  /hire/cs/pricing
2.  In all three: DevTools → Network → reload → click the document
    request → Headers → `x-edge-del-v2` confirms which mode is active.
3.  Tab A: scroll. Empty page, placeholder text. No experiment ran.
    DevTools → Application → Cookies → VMAP is empty. View Source
    contains the placeholder and nothing else.
4.  Tab B: scroll. Full Indeed pricing page. VMAP is populated. View
    Source contains the 54 KB variation. Edge Delivery works.
5.  Tab B: click "Home" in the site nav. Nuxt SPA-navigates to /.
    Then run in DevTools console:
        $nuxt.$router.push('/hire/cs/pricing')
    Wait a second. Variation is GONE. The placeholder is back. This is
    the customer's "the experiment vanishes when users navigate around
    the SPA" complaint.
6.  Tab C: repeat the same Home-then-router-push sequence. Variation
    is still there. Open DevTools console:
        __EDGE_DEL_V2__.events
    You will see the companion's `route:applied` events firing on
    every router push — that is what kept the variation alive.
7.  Optionally, also navigate Tab C from /pricing → /hire/cs/pricing
    to demonstrate that the lab covers two different decomposed
    experiments and the companion handles both.
```

---

## What this proves

Indeed asked: "Can we take a monolithic 54 KB Custom Code variation and
decompose it into Visual-Editor primitives so Optimizely Edge Delivery
can apply it at the edge?" The answer documented in
`../indeed-pricing/README.md` was **yes** — but it was a paper
answer. This folder is the runnable version.

We took the four resolved Indeed changes verbatim and authored them
against a lab page that mirrors Indeed's `/hire/cs/pricing`. The
production-shape decomposition uses **five** of Optimizely's
authoring primitives — four creatable via REST, one in the Visual
Editor:

| # | Type           | Authoring surface | Selector / target                                    | What it does                                                                                 |
| - | -------------- | ----------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1 | `insert_html`  | REST              | `main` (prepend)                                     | Drops the 54 KB pricing payload (tier cards, comparison table, FAQ, hire-more, explore-more) |
| 2 | `attribute`    | REST              | `.hasTransparentGnavBackground` (class → "")         | Removes the transparent-nav class from the page header                                       |
| 3 | `rearrange`    | Visual Editor     | `[data-tn-section="header"]` before `.opt-moo-1399`  | Moves the header above the FAQ block                                                         |
| 4 | `custom_code`  | REST              | (n/a — global script)                                | A small (1.8 KB) MutationObserver that wires up FAQ accordion, tooltips, comparison collapse |
| 5 | `custom_css`   | REST              | (n/a — variation-scoped CSS, appended to `<head>`)   | Variation-scoped styling for the Indeed tier classes (`.tier`, `.tier__item`, etc.)          |

Three of the five changes carry the variation's *content* (HTML, JS,
CSS — changes 1, 4, 5). Two are *surgical edits* on existing markup
(changes 2, 3). All five live in Optimizely; **nothing** touches the
customer's source code.

The rearrange must be authored via the Visual Editor because the
public REST API doesn't expose `rearrange` as a creatable change type.
Everything else is one REST call.

## Why "decomposition" matters

Indeed's original variation was a single Custom Code block. Custom Code
runs client-side **only** — Optimizely's edge worker cannot evaluate it,
so the 54 KB of pricing markup never makes it into the SSR response.
View Source on the original variation showed an empty pricing slot;
search-engine crawlers and first-paint metrics saw nothing.

After decomposition:

- Change 1 is `insert_html` → activation type `immediate` → Edge
  Delivery applies it at the edge. The pricing markup is in the SSR
  body. View Source shows the variation. First Contentful Paint
  includes it.
- Change 2 is `attribute` → also `immediate`. Edge applies it.
- Change 3 is `rearrange` → also `immediate`. Edge applies it.
- Change 4 is `custom_code` → activation type stays `dom_changed`.
  Runs in the browser only. Edge skips it. That's correct — it is a
  thin client-only wiring layer (event delegation, attribute toggles).

The result: 99% of the variation payload is delivered at the edge,
visible to crawlers, present in View Source, alive at byte zero of the
response. Only the behaviour shell ships as Custom Code.

## What's in this folder

```
README.md                                       — this file
publish-via-api.py                              — creates the experiment, REST-authors
                                                  changes 1, 2, 4 on Variation #1, starts it
change-5-custom-css.css                         — the variation-scoped CSS body
add-custom-css-change.py                        — appends change 5 (custom_css) to the variation;
                                                  idempotent, preserves the Visual-Editor rearrange
verify.mjs                                      — Playwright validator, 6 phases, all-or-nothing
shoot-modes.mjs                                 — captures the six training screenshots
probe.mjs / probe-modes.mjs / probe-spa.mjs     — dev-time DOM probes; safe to ignore
screenshot-1-control-cold.png                   — mode 1, just-loaded
screenshot-1-control-after-spa-roundtrip.png    — mode 1, after SPA navigation away and back
screenshot-2-variation-only-no-reinforce-cold.png
screenshot-2-variation-only-no-reinforce-after-spa-roundtrip.png
screenshot-3-variation-plus-reinforce-cold.png
screenshot-3-variation-plus-reinforce-after-spa-roundtrip.png
```

## How to reproduce

### 1. Publish the experiment (REST: changes 1, 2, 4)

```bash
# REST token lives in optly-mcp-server/.env (line: OPTIMIZELY_API_TOKEN=...)
export OPTIMIZELY_API_TOKEN=$(grep '^OPTIMIZELY_API_TOKEN=' \
  /mnt/c/Users/LAH/Documents/__Development/Optimizely/optly-mcp-server/.env | cut -d= -f2)

python3 decomposition-pattern/lab-indeed-emulation/publish-via-api.py
```

This creates:

- a URL-targeting Page for `/hire/cs/pricing`
- an A/B experiment named *Indeed Pattern — Lab Emulation*
- Variation #1 with changes 1, 2, 4 (insert_html, attribute, custom_code)
- 100% traffic to Variation #1
- starts the experiment and waits for the manifest to flush

### 2. Add the variation-scoped CSS (REST: change 5)

```bash
python3 decomposition-pattern/lab-indeed-emulation/add-custom-css-change.py
```

This reads `change-5-custom-css.css` from this folder and appends it
to Variation #1 as a `custom_css` change. The script is idempotent —
re-run it after editing the CSS file to push updates without
duplicating the change. It also cycles the experiment (pause +
restart) to flush the CDN manifest.

### 3. Add the rearrange in the Visual Editor (change 3)

REST does not expose `rearrange`. Open the experiment in the app:

> <https://app.optimizely.com/v2/projects/5953372780494848/experiments>
> → *Indeed Pattern — Lab Emulation*
> → Variation #1 → Edit
> → click the page header (the element with `[data-tn-section="header"]`)
> → Move Element → target `.opt-moo-1399` → position Before → Save

This takes ~60 seconds. The variation now mirrors Indeed's exactly.

### 4. Run the verifier

```bash
node decomposition-pattern/lab-indeed-emulation/verify.mjs
```

The verifier runs six phases and all must pass:

1. **Manifest state** — the *Indeed Pattern — Lab Emulation* layer is
   in the cdn.optimizely.com manifest.
2. **SSR body** — the 54 KB Indeed payload (Sponsored Job plans
   headline, `id="opt-1445"`, `.opt-moo-1399`, FAQ buttons, hire-more,
   explore-more) is present in the raw HTML response, before any JS
   runs. This proves *edge* delivery.
3. **Post-hydration DOM** — Vue 3.5 hydrates over the variation. The
   tier section (`#opt-1445`), the FAQ wrapper (`.opt-moo-1399`), and
   the page header all survive. The `hasTransparentGnavBackground`
   class was removed (Change 2 applied and stuck). All 9 FAQ buttons
   are clickable.
4. **Rearrange** — header element comes BEFORE `.opt-moo-1399` in
   document order. Only checked if Change 3 was authored.
5. **Interactive behaviour** — clicking a FAQ button toggles its
   `.active` class. This proves Change 4's Custom Code shell is
   running and wired up.
6. **SPA persistence** — navigate `/hire/cs/pricing → / → /hire/cs/pricing`.
   The variation must survive each navigation. The companion is what
   makes this work; without it, Vue's `<NuxtPage>` re-mount on the
   second visit would render the placeholder page and lose the
   variation.

Last green run:

```
=== verdict ===
  ALL CHECKS PASSED
```

## Authoring discipline — where does each piece live?

This is the most important section for the rapid-experimentation
engineer. Get this wrong and every experiment becomes a code-change
request on the customer's eng team; get this right and the customer is
read-only as far as the experiment is concerned.

Optimizely's variation gives you three authoring surfaces:

```
Variation
├── Changes list                  ← what the variation does
│     • insert_html   (HTML content)
│     • attribute     (surgical edit)
│     • rearrange     (Visual Editor only)
│     • custom_code   (JS behaviour)
│
└── Custom CSS field              ← variation-scoped styling
       (REST exposes this as a `custom_css` change with
        type=custom_css; the SDK serialises it as
        an append-<style>-to-<head> at runtime)
```

Plus the Page conditions (URL targeting, audience) — outside the
variation, won't touch this here.

**The discipline: anything experiment-specific MUST live in
Optimizely.** If you find yourself wanting to add a stylesheet to the
customer's repo, or wanting to push a new HTML partial to the
customer's CMS, stop. The discipline is intact when the engineer
working on the experiment has nothing to commit to the customer's
repo.

How that decision flow looks for the Indeed pattern:

| Concern               | Where it lives                                  | Why                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 54 KB pricing markup  | Change 1, `insert_html` change on Variation #1  | Variation content. REST authorable. Same place a Visual Editor "Insert HTML" element would land it.                                                                                                                            |
| Behaviour shell (JS)  | Change 4, `custom_code` change                  | Variation behaviour. Custom Code is the only place a `MutationObserver` should sit; the variation's *content* alone can't wire itself up.                                                                                       |
| Tier card styling     | Change 5, `custom_css` change                   | Variation-scoped CSS. The customer's site does NOT have `.tier`/`.tier__item` styling; the variation needs it; therefore the variation provides it. Never goes in the customer's stylesheet — those rules don't apply to other experiments. |
| Header transparent-nav class fix | Change 2, `attribute` change            | Surgical edit to existing customer markup. The customer's markup already has the class; the variation just clears it.                                                                                                          |
| Header above FAQ      | Change 3, `rearrange` change (Visual Editor)    | Surgical reorder of existing customer markup.                                                                                                                                                                                  |

### The lab's special situation, and why this discipline applies anyway

On Indeed's real site, the production stylesheet already defines
`.tier`, `.tier__item`, `.tier__title` etc. — the variation reuses
them. On *our lab*, we host Indeed's payload on a Nuxt page that does
not have those classes defined anywhere. Without something to provide
them, the variation renders as unstyled HTML.

The right way to handle this for the lab — and for any customer
engagement where the variation introduces classes the customer's
stylesheet doesn't define — is to ship the missing CSS **as a
`custom_css` change on the variation**, not as a code change in the
customer's repo. That's what
`decomposition-pattern/lab-indeed-emulation/change-5-custom-css.css`
contains, and that's what `add-custom-css-change.py` pushes into
Optimizely.

If you inspect the served HTML for `/hire/cs/pricing` and search for
the lab's tier styles, you will find them inside a `<style>` tag that
Optimizely's SDK appended to `<head>` — not in the page's source HTML.
That is the proof the discipline is intact: the customer's compiled
page does not contain experiment-specific CSS; Optimizely injected it
at the edge from the variation's `custom_css` change.

## What was hard, and what we learned

Three things bit us getting this to work. Worth flagging because each
will hit a customer landing this pattern on a Vue or React app.

### Multi-root insert_html payloads survive hydration only with a per-root reconciler

Indeed's 54 KB payload has three sibling root elements: `<div id="opt-1445">`,
a `<style>` block, and `<div class="opt-moo-1399">`. Vue's hydration
recovery can selectively keep one and discard the others — we
observed `#opt-1445` survive while `.opt-moo-1399` was torn down.

The companion's `applyAdd` (`reinforce/src/ops.ts`) walks every
template root, checks whether each is already present in the DOM
(by id, then by tag+class signature), and splices missing roots back
in next to their preserved sibling. The full multi-root fragment is
restored after every hydration, route change, or destructive Vue
re-render.

### Selector specificity matters when the page has a layout-level `<main>`

Optimizely's edge worker matches CSS selectors against the SSR DOM.
Indeed's variation uses `selector: "main"`. On the real Indeed site
that selector picks the page's content area because Indeed's layout
doesn't have an outer `<main>` wrapper. Our Nuxt app shell originally
had `<main class="site-main"><NuxtPage /></main>` — so the variation
hit the wrapper, not the page's own `<main>`. Vue's hydration walks
into the wrapper expecting `NuxtPage`'s render and instead finds the
variation; recovery tears down the page.

Fix: the lab shell now uses `<section role="main">` so each page owns
its own `<main>`. The variation's `selector: "main"` lands exactly
where Indeed intends. See `target-app/app.vue` for the comment.

### Vue 3.5's `data-allow-mismatch` is the unblock for legitimate edge-injected content

The page's `<main>` carries `data-allow-mismatch="children"`. This
declares to Vue that children of this element are allowed to differ
between the SSR HTML and the client-side vDOM, which is exactly the
contract edge variations need. Without it, Vue logs a hydration
mismatch and replaces the variation content with the page template's
empty placeholder.

The companion still owns SPA navigation re-apply — `data-allow-mismatch`
is purely an initial-hydration concession. See
`target-app/pages/hire/cs/pricing.vue` for the in-code comment.

## What the engineering team should look at first

1. Open the live URL in a browser.
2. View Source. Search for `Sponsored Job plans`. It is at line ~50 in
   the SSR. Pre-JS, pre-hydration, edge-delivered.
3. Open DevTools → Network → reload. The first HTML response is 600+
   KB. Look at the response body — the variation content is in it.
4. Click around in the page (FAQ accordion, tooltips). The behaviour
   shell is wired up.
5. Click the *Home* link, then navigate back. The variation is still
   there.
6. Run `verify.mjs` to confirm everything programmatically.

Then read `../indeed-pricing/README.md` for the original customer
ask, and `../../CUSTOMER-GUIDE.md` for how to teach the pattern to
new customers.
