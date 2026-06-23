# 0 — SuiteCommerce Advanced: what makes this different

## What SCA is, in one paragraph

SuiteCommerce Advanced (SCA) is NetSuite's full-source-access
e-commerce storefront. It is a **Backbone.js Single-Page Application**.
The first request returns a server-rendered shell template (the SSP);
after that, every navigation — product detail, cart, facet filter,
checkout step — is a Backbone router event that swaps a Backbone View
into the DOM client-side. No new HTTP request to the server; no new
full-page paint. The closest mental model from modern frameworks is
"like Next.js without SSR" — but written in 2014 by a team that hadn't
yet adopted React.

## What this means for an Optimizely Web Experimentation deployment

It does NOT mean any of the Vue/Nuxt/React SSR hydration problems we
chase elsewhere. SCA is **client-rendered, not server-rendered**, so
there is no "hydration mismatch" or "framework recovery overwriting our
DOM" pattern. Backbone doesn't reconcile a virtual DOM against a
server-rendered DOM — it just runs `view.render()` and dumps the
result into a container element.

What it DOES mean:

1. **The DOM the snippet sees on first run is empty (or near-empty).**
   The SSP shell is just a `<div id="main-content"></div>` container.
   Backbone fetches data, then `render()` populates it.
   Optimizely's variation code that runs immediately misses its
   target. This is the **timing problem**.

2. **There is never a full page reload after the first request.**
   PLP → PDP, Cart → Checkout, refining facets — all are Backbone
   routes that swap one view for another. Optimizely's snippet runs
   exactly once unless you tell it otherwise. The variation applied to
   view A is gone when view B replaces it. This is the
   **SPA navigation problem**.

3. **Sections of the page re-render in place without changing the URL.**
   Mini-cart opens. Facet sidebar updates. Quantity changes in the cart.
   Backbone calls `view.render()` on the affected region and the
   contents are replaced. Variation DOM inside that region — gone.
   This is the **section re-render problem**.

These three problems are why a vanilla snippet install is unreliable on
SCA. They are the three problems this pack solves.

## Why this is NOT the Shopify-style "you can't touch checkout" problem

Marketing teams sometimes lump SuiteCommerce together with Shopify
because both have "constraints." They're different constraints.

| Shopify | SuiteCommerce Advanced |
|---|---|
| Hosted checkout you cannot modify | Full source access; you CAN modify checkout |
| Constraint: locked-down platform | Constraint: native scripts you can break |
| Limitation removed by Plus + Checkout Extensibility | Limitation removed by careful QA discipline |

SCA gives you everything Shopify locks down. With that access comes
the responsibility not to break the native validation scripts that
protect payment processing. We treat checkout as a separate, opt-in,
high-QA experimentation track. See `4-checkout-safety.md`.

## What Optimizely's product team's "should work" answer is missing

When Optimizely tells a customer "yes, Web Experimentation supports
SPAs — turn on Support for Dynamic Websites," they are correct but
incomplete. DSW (the MutationObserver-driven re-application feature)
covers most of the SPA navigation problem and most of the section
re-render problem **for visual changes** (text, class, attribute,
style, HTML). It does NOT cover:

- **Custom Code changes** — not re-applied on view swap; the JS runs
  once and that's it. On the snippet side, "Custom code cannot be
  reverted" is documented; on the re-apply side, behavior is
  inconsistent.
- **Rearrange changes on SPAs** — officially unsupported
  (*Dynamic websites and single-page applications*).
- **Edge cases where the MutationObserver misses a mutation** — batched
  re-renders, multi-root insertions, race conditions during fast
  successive route changes. The official React SSR doc admits these:
  > "React hydration often involves rapid, batched DOM updates.
  > MutationObservers might not capture all subtle changes."

DSW is the snippet's own answer to the SPA problem. The reinforcement
layer in this pack is the **second line of defense** that catches what
DSW misses: it watches Backbone's own router and view-swap signals,
re-derives the variation's ops from `window.optimizely.get('data')`,
and re-applies them idempotently. It does NOT replace DSW; we run
**both** (DSW on, plus the companion). They cover different gaps.

## Who is this for

Mystery Ranch engineering, primarily. The lessons generalize to any
SuiteCommerce Advanced customer (and to legacy Backbone storefronts
in general — Magento 1, older Shopify themes pre-Hydrogen, custom
Backbone builds). Where SCA-specific knowledge matters (the SSP shell
template, `LiveOrder.Model`, the `Backbone.history.start({ pushState })`
configuration) we say so.

## What you need before you start

- An SCA codebase with full source access. (If Mystery Ranch is on
  templated SuiteCommerce — not Advanced — flag it before proceeding.
  Most of this pack still applies, but snippet-placement options
  narrow significantly.)
- An Optimizely Web Experimentation project provisioned for the
  Mystery Ranch domain.
- The project's "Support for Dynamic Websites" toggle ON
  (Settings → Implementation).
- The Optimizely snippet URL (the `cdn.optimizely.com/js/<id>.js` URL
  for the project).

That's it. The companion is ~10 KB of JS the customer copies into the
repo or pastes into Optimizely's Project JavaScript pane. No npm
package, no build server changes, no platform-specific tooling beyond
what SCA already has.
