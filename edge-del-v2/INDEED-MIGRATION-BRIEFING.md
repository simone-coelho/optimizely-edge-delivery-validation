Indeed — Performance Edge → Edge Delivery Migration: Briefing
==============================================================

Purpose
-------

A briefing memo for the kickoff conversation with Indeed engineering.
The Optimizely Rapid Experimentation team has already been briefed
internally on the authoring-side changes. This document is the
customer-side framing — what changes for *Indeed* when they migrate.

The conversation has three goals:

1. Confirm that the day-to-day relationship doesn't change — the
   Rapid Experimentation team continues to author Indeed's experiments.
2. Explain that what does change is the *delivery substrate*, and that
   this introduces one new piece of infrastructure on Indeed's side:
   an edge worker.
3. Set expectations for what Indeed engineering will install,
   maintain, and operate.

This memo is paired with the implementation reference in
`reinforcement-layer/CUSTOMER-GUIDE.md`. That document is the manual.
This document is the conversation.


Background — what's actually different
---------------------------------------

Indeed currently runs on Performance Edge. Performance Edge is a
client-side product:

- A small JavaScript snippet sits on the page.
- The snippet downloads variation code and runs it in the browser.
- Variations are typically large IIFEs that poll for DOM elements
  (`waitForElement`), then mutate.
- Nothing happens at the CDN. The page Indeed's origin serves and the
  page the user initially receives are identical; the variation gets
  applied client-side after the page loads.

Indeed is migrating to Edge Delivery. Edge Delivery is an edge
product:

- A worker sits at the CDN, between the user and Indeed's origin.
- The worker calls the Optimizely SDK before the response reaches the
  user.
- The SDK applies the variation operations to the HTML stream.
- The user receives an already-modified page. The change is in the
  response bytes, not painted on after the fact.

The benefits are well documented (faster, no flash-of-original-content,
SEO-visible, no `waitForElement` race conditions). The cost is that a
worker must exist at Indeed's edge — something Performance Edge didn't
require. That worker is the new piece of infrastructure this
conversation is about.


What stays the same for Indeed
------------------------------

- **The Optimizely UI.** Variations are authored in the same web
  console.
- **The Rapid Experimentation team.** Optimizely continues to build
  and launch Indeed's experiments on Indeed's behalf. The
  experimentation pipeline, calendar, and approval process don't
  change.
- **Reporting.** Results, lift, statistical significance — same data
  model, same dashboards.
- **Indeed's origin application.** The worker passes the response
  through; it does not replace any part of Indeed's stack.


What changes for Indeed
-----------------------

Indeed becomes responsible for one new piece of infrastructure: the
**Edge Delivery worker**.

This is a Cloudflare Worker (or any V8 / Workerd-compatible edge
runtime — the SDK is platform-neutral). The worker is a small bundle
that contains three pieces:

1. **The Optimizely Edge Delivery SDK** — `@optimizely/edge-delivery`,
   published by Optimizely. This is what fetches the variation
   manifest and applies operations to the HTML stream.
2. **The companion script (the reinforcement layer)** — a roughly
   11 KB browser script (~3 KB gzipped) that re-applies any operation
   the SPA framework's hydration cleanup discards. Two supported
   install modes — both fully first-class — and the choice is Indeed's:
     - **Mode 1 — worker inlines the companion.** The worker emits
       the companion as an inline `<script>` block before `</body>`.
       Indeed does nothing additional on the page side; deploying
       the worker IS deploying the companion. Requires CSP that
       permits inline scripts (or per-request nonce).
     - **Mode 2 — application code installs the companion.** Two
       flavors:
         - Flavor 2a — companion is a static asset in Indeed's
           public directory, referenced via `<script src>` from the
           root layout.
         - Flavor 2b — companion is vendored under Indeed's app
           source tree and imported via the bundler so it ships
           inside the main application JS artifact.
       In either Mode 2 flavor, the worker omits the companion
       inline emit (the inline JSON manifest tag is still emitted —
       the companion needs it). CSP-friendly: `script-src 'self'`
       is sufficient.
3. **A pass-through to Indeed's origin.** The worker forwards
   requests to Indeed's origin, pipes the response through the SDK +
   companion, and returns the modified stream.

Optimizely will provide a reference worker that Indeed can deploy
as-is. The reference worker is what we run in our validation lab and
what we use to verify variations before recommending the migration. If
Indeed already runs a Cloudflare Worker at the edge for other
purposes, the reference can be integrated into that existing worker
instead of being deployed standalone.

### Why the companion script matters specifically for Indeed

Indeed's site is a single-page application. Modern SPA frameworks
(React, Vue, Angular, Svelte) hydrate server-rendered HTML on page
load — and during that hydration step, the framework compares the
HTML in the page against what its own templates expect. If the SDK
injected a banner or a pricing-card variation into the page at the
edge, the framework can interpret it as foreign content and remove it
during recovery.

This is a known industry behaviour, not an Optimizely-specific bug,
and we have measured it directly. Twenty different change types
tested against a Vue 3.5 SSR target; the SDK applies all twenty
correctly at the edge; the SPA framework's hydration step discards a
subset. The companion script exists to re-apply those discarded
operations on the framework's signal that hydration is complete.

This piece is critical for Indeed *because* their site is an SPA.
A non-SPA customer migrating from Performance Edge to Edge Delivery
would not need it. Indeed does. Performance Edge didn't need it
because it ran after hydration, in the browser, by design.

Empirical map of which change types Vue/React tolerate natively and
which require the companion is documented in
`reinforcement-layer/FINDINGS.md` for the engineer who wants the
data.


Indeed's responsibilities
-------------------------

1. **Deploy the edge worker.** Either deploy Optimizely's reference
   worker as-is, or integrate it into Indeed's existing Cloudflare
   configuration. The worker URL must be the URL the user visits —
   the worker is the public-facing edge, not a sidecar.
2. **Configure the worker.** Three values: the Optimizely snippet ID,
   the project ID, and the origin URL the worker should pass through
   to.
3. **Ship the companion alongside the SDK.** The companion is bundled
   into the worker package. Indeed's deployment pipeline keeps the
   SDK and the companion versions in lockstep — Optimizely publishes
   them together; the worker imports them as a pair.
4. **Maintain the worker.** Deploy updates when Optimizely publishes
   new SDK versions (security, bug fixes, support for new change
   types). The maintenance posture is comparable to any other edge
   dependency Indeed already operates.
5. **Choose a companion install mode** — Mode 1 (worker inlines) or
   Mode 2 (application code installs, with flavor 2a static asset or
   2b vendored import). Both are fully first-class — they produce
   identical runtime behavior; the choice is about who owns the
   companion's deploy lifecycle and whether CSP can allow inline
   scripts. The Mode-1-vs-Mode-2 choice is a single code-level
   decision the worker code reflects; it is not a runtime toggle.
   The decision matrix in CUSTOMER-GUIDE.md § 8.3 walks through the
   trade-offs in detail. Short version: if Indeed's edge-worker team
   and application team are the same group on the same cadence,
   Mode 1 is the smaller diff; if they're separate teams or CSP
   forbids inline scripts, Mode 2 is the right answer.
6. **Provide a named technical owner.** The Rapid Experimentation team
   needs a counterpart at Indeed for the worker rollout and for
   ongoing version bumps.


Optimizely's responsibilities
-----------------------------

1. **Author Indeed's variations.** The Rapid Experimentation team
   continues to receive Indeed's experiment requests, build the
   variations, and launch them. The team has adopted a new authoring
   pattern (the decomposition pattern, documented in
   `decomposition-pattern/VARIATION-DECOMPOSITION-GUIDE.md`) that
   produces variations compatible with the Edge Delivery model.
2. **Publish the SDK and the companion together.** SDK engineering
   owns the runtime; product owns the release cadence. They ship as
   a pair so Indeed never has a version skew.
3. **Provide the reference worker.** A drop-in bundle Indeed can
   deploy as the starting point. This is the bundle we validated.
4. **Support Indeed engineering through the integration.** Help
   wire the worker into Indeed's Cloudflare account, configure
   routing, verify the first variation lands correctly, walk through
   the verification harness.
5. **Own the failure mode catalogue.** The empirical hydration map is
   our basis for the promise that variations survive. If a future
   variation pattern breaks, the fix lands in the SDK + companion —
   not in Indeed's worker.


What the meeting should achieve
-------------------------------

| Goal                                            | Outcome to confirm                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Indeed accepts ownership of the edge worker.    | Indeed engineering agrees in principle, names a technical owner.                    |
| Deployment vehicle identified.                  | Cloudflare Workers (most likely), or alternative if Indeed has a different edge.    |
| Integration point identified.                   | Which traffic routes through the worker — full site, or scoped to experiment URLs.  |
| Maintenance posture accepted.                   | Indeed will deploy SDK + companion updates on Optimizely's release cadence.         |
| Companion install mode chosen.                  | Mode 1 (worker inlines) OR Mode 2 (application code installs, 2a static asset or 2b vendored import). |
| Migration timeline clarified.                   | When does Performance Edge get decommissioned for Indeed; phased or hard cutover.   |


Talking points (for the room)
-----------------------------

- "Your relationship with our Rapid Experimentation team doesn't
  change. We continue to build your variations end-to-end. What
  changes is the substrate underneath."
- "Performance Edge is client-side. Edge Delivery is edge-side. Same
  UI, same team, same reporting — different delivery point."
- "Edge Delivery requires a worker at the CDN. Indeed doesn't have
  one for Optimizely today. That worker is the new piece of
  infrastructure your engineering team will own."
- "We provide the worker. It's a reference bundle that includes the
  SDK and a small browser-side companion script. You deploy it as-is
  or integrate it with your existing Cloudflare setup — your
  choice."
- "Two equally-supported install modes for the companion. Mode 1:
  the worker emits the companion inline in every response — zero
  work on your application code beyond a one-line `useEffect` in
  your root layout that signals hydration is done. Mode 2: your
  application code installs the companion (either as a static asset
  or vendored into your main JS bundle), and the worker omits the
  companion inline emit. The runtime behavior is identical; the
  choice is about deploy ownership and CSP fit. Both modes are
  first-class — pick whichever matches your operational model."
- "The companion script exists because your site is an SPA.
  Hydration can throw away edge-applied DOM during the
  framework's recovery step. The companion re-applies any operation
  hydration discarded. This is a known industry pattern; we have
  empirical data on which change types need it and which survive
  natively."
- "Maintenance is light. When Optimizely publishes a new SDK
  version, you deploy it the way you'd deploy any other edge
  dependency. The companion ships with the SDK — they're released
  as a pair, so there's no version-skew risk."
- "Indeed engineering owns the worker. Optimizely owns the
  variations, the SDK, the companion, and the support during
  integration."
- "First milestone: a clean replication of the variations Rapid Exp
  currently runs for you on Performance Edge, re-authored under the
  new pattern. Once that's running cleanly on Edge Delivery for a
  fixed window, you're off Performance Edge for new experiments."


Open questions for Indeed
-------------------------

- Does Indeed already run a Cloudflare Worker at the edge for other
  purposes? If yes, we can integrate; if no, the reference worker is
  the deployment baseline.
- What's the CSP posture on inline scripts, and how is the
  application-team / edge-worker-team ownership split at Indeed?
  Both inputs feed the Mode 1 vs Mode 2 decision: same team / lenient
  CSP → Mode 1 (worker inlines) is the smaller diff; separate teams
  / strict CSP → Mode 2 (application code installs, 2a or 2b) is the
  right answer. Decision matrix in CUSTOMER-GUIDE.md § 8.3. Both
  modes work end to end; we just need to know which path before the
  first rollout.
- Which routes are eligible for experimentation? Full site, or a
  scoped subset?
- Who's the named engineering counterpart at Indeed for the worker
  rollout, both for the initial integration and for ongoing version
  bumps?
- What's the Performance Edge decommissioning timeline Indeed wants?
  This determines the migration plan (do existing PE experiments
  finish out, or do we cut them over).


What we have validated in the lab — be precise about this
---------------------------------------------------------

If anyone asks "have you actually proved this works?", here's the
honest answer:

- **Yes**, the reinforcement layer holds an Insert-HTML variation
  through Vue 3.5 SSR hydration end-to-end, against a real
  Optimizely experiment authored in a real Optimizely project,
  running through the reference worker deployed at
  `https://edge-del-v2-target.pages.dev/`. Twenty-case hydration map
  in `reinforcement-layer/FINDINGS.md`.
- **Partially**, on the decomposition-pattern side. The
  three-bucket pattern is documented and the Indeed `Sponsored Job
  plans` variation has been decomposed into the four expected
  changes (Insert HTML, Attribute, Rearrange, Custom Code). The
  end-to-end pipeline test on `/pricing` of the lab is staged but
  awaiting the experiment being authored in the lab's Optimizely
  project; once that's authored, we'll have the multi-change result
  too.

Don't overstate the second bullet. The pattern is sound, the
decomposition is in place, the test runner is pre-staged — but the
fully-integrated multi-change-survives-hydration result is the next
deliverable, not done yet.


Reference materials to share (after the meeting)
------------------------------------------------

For Indeed engineering:
  - `reinforcement-layer/CUSTOMER-GUIDE.md` — the implementation
    reference: architecture, install steps, framework adapters,
    debugging.
  - `reinforcement-layer/FINDINGS.md` — empirical hydration data,
    for the engineer who wants to know *why* the companion exists.

For Indeed's internal experimentation team (optional, if they ever
author their own variations):
  - `decomposition-pattern/VARIATION-DECOMPOSITION-GUIDE.md` — the
    authoring pattern the Rapid Experimentation team is using.


Appendix — a one-sentence answer to each likely Indeed question
---------------------------------------------------------------

> "Why can't we just keep doing what we're doing?"

Performance Edge is being decommissioned. Edge Delivery is the
replacement product, and the underlying delivery model is different
in ways that need a worker at the edge.

> "Why is there a worker now? We never had one before."

Because Edge Delivery applies variations at the CDN, not in the
browser. To apply variations at the CDN, code must run at the CDN.
That code is the worker.

> "Why is there a *second* script alongside the SDK?"

Because your site is an SPA, and SPA hydration can throw away
edge-applied DOM. The companion script re-applies any operation
hydration discarded. It ships *inside* the worker bundle — by
default the worker emits it inline in the response; you don't add
anything to your pages. The only case where you'd install it
yourself is if your CSP prohibits inline scripts, in which case it
becomes a small static asset in your existing bundle and we flip a
single worker config flag. It exists for SPA customers only — non-SPA
customers don't ship it.

> "Do we have to put a script tag on our pages?"

Not in the default configuration. The worker injects the companion
inline before `</body>`, so your page templates don't change. You
only add a script tag yourself in the strict-CSP mode, where the
companion is hosted as a static asset in your bundle.

> "Do we have to write the worker?"

No. We provide a reference worker. You either deploy it as-is or
integrate it into a Cloudflare Worker you already operate.

> "What does ongoing maintenance look like?"

When Optimizely publishes a new SDK + companion pair, you deploy the
new bundle. The cadence is comparable to any other edge dependency.
We provide release notes; you provide the deploy.

> "What if a variation breaks something on our site?"

The SDK + companion are owned by Optimizely. Bug reports go to us,
fixes ship in the SDK + companion bundle, you deploy the update. The
variation logic itself is authored by our Rapid Experimentation team,
so authoring-side defects are also our responsibility to resolve.

> "Who do we call when something goes wrong?"

The same Optimizely support path you use today, plus your named
counterpart on the Rapid Experimentation team. The technical owner
on Indeed's side and the technical owner on Optimizely's side stay
the same across releases so context isn't lost.
