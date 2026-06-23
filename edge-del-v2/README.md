Edge Delivery Validation Kit v2
================================

This kit holds two distinct work streams that share one piece of
infrastructure. They address different problems, ship to different
audiences, and could be delivered independently. They are organised in
subdirectories so the separation is obvious from the file tree.


Two work streams
----------------

### Stream A — `reinforcement-layer/`

The GitLab engagement. A runtime addition that ensures Optimizely Edge
Delivery variations survive Vue / React hydration recovery on SSR
pages. Deliverable is a code addition to `@optimizely/edge-delivery`
(an HTMLRewriter post-processing pass that scans the SDK's existing
`data-optly-<changeId>` markers, plus an inline ~4 KB browser
companion script that idempotently re-applies any operation the
framework discarded). Validated end-to-end against a deployed Pages
+ Worker lab with a real Optimizely experiment.

  Audience:
    - Optimizely SDK engineering — owns the SDK extension.
    - Optimizely product — owns the productisation decision (default
      on? opt-in? bundled vs separate package?).
    - Customer engineering teams running Optimizely Edge Delivery on
      a Vue / React SSR site (GitLab is the named customer; other
      customers with comparable stacks benefit identically).

  Key documents (all under `reinforcement-layer/`):
    - `CUSTOMER-GUIDE.md` — the authoritative architecture +
      installation reference. Covers Stream-A SDK side, Stream-A
      customer side, framework adapters (Vue / React), debugging,
      productisation notes.
    - `FINDINGS.md` — empirical hydration map (which change types
      Vue actually recovers vs tolerates natively, plus mechanism
      isolation tests with the companion blocked).
    - `PLAYBOOK-V2.md` — operational runbook (how to deploy, run the
      harness, etc.).
    - `customer-email.md` — short customer-facing summary, ready to
      send.
    - `research-clientside-api.md` — Optimizely client-side
      JavaScript API reference (event listeners, state APIs, DSW
      mechanism). Used to inform whether the reinforcement approach
      transfers to the non-edge client-side delivery path.

### Stream B — `decomposition-pattern/`

The Indeed engagement (via the Rapid Experimentation team). An
authoring pattern: take a large Custom Code variation (the kind the
team writes today for Performance Edge — `waitForElement` polling
delivering tens of KB of inline HTML+CSS), and decompose it into a
small set of Visual Editor changes (applied at the CDN by Edge
Delivery) plus a minimal post-hydration Custom Code shell. The result
runs faster, is SEO-visible, and authored once per variation costs
less to maintain.

  Audience:
    - Optimizely Rapid Experimentation team — the primary consumer
      of the pattern; uses it to migrate variations from Performance
      Edge to Edge Delivery on customer programs.
    - Optimizely product — owns the tooling roadmap (the proposed
      Variation Decomposer that automates the AST walk).
    - Customer experimentation teams who author their own
      variations — they can apply the same decomposition once
      onboarded.

  Key documents (all under `decomposition-pattern/`):
    - `VARIATION-DECOMPOSITION-GUIDE.md` — the pattern reference,
      with three-bucket decomposition rules, change-type matrix,
      worked-example pointer, performance characteristics, edge
      cases.
    - `indeed-pricing/` — the actual decomposed Indeed "Sponsored
      Job plans" variation. The folder contains `change-1-insert-html.html`
      (the resolved 54 KB HTML payload for Insert HTML), `change-4-custom-code.js`
      (the behaviour shell), `resolve.js` (the script that produced
      the HTML payload by resolving the original variation's
      template literals), and a `README.md` with the four-change
      walkthrough.
    - `lab-test-redesign/` — a synthetic four-change test variation
      authored against our deployed lab's `/pricing` page. Used to
      validate that the decomposition pattern survives a real
      Optimizely SDK + Edge Delivery pipeline before recommending it
      to the team. Contains `change-1-insert-html.html`,
      `change-4-custom-code.js`, and a `README.md` with the test
      plan.


Relationship between the two streams
-------------------------------------

They compose; they do not depend on each other.

- A non-SPA customer adopting Stream B (the decomposition pattern)
  needs only Stream B. Edge-applied DOM stays put on non-hydrating
  pages.
- An SPA customer adopting Stream B needs *both* — the decomposition
  pattern produces edge-applied DOM, which on a Vue / React SSR site
  is exactly what Stream A protects from hydration recovery. Without
  Stream A in the customer's stack, a decomposed variation hits the
  same hydration-discard problem Stream A was built to solve.

In practice this means: for customers on a hydrating SPA framework,
both streams ship together. For customers on a non-hydrating page,
Stream B alone is sufficient.


Shared lab infrastructure
-------------------------

The directories below the streams (`target-app/`, `edge-worker/`,
`reinforce/`, `experiments/`, `harness/`, `runs/`) are a single
deployable lab. The lab is on Cloudflare Pages at
`https://edge-del-v2-target.pages.dev/`. The same lab serves three
purposes:

1. **Stream A validation.** The existing `Labco HP` Optimizely
   experiment (project `5953372780494848`) inserts a banner inside
   the `/` page's pricing-cards v-for; the deployed worker proves
   the reinforcement layer holds the variation through hydration.
2. **Stream B validation.** A second Optimizely experiment authored
   against `/pricing` exercises the four-change decomposition
   pattern (Insert HTML, Attribute, Rearrange, Custom Code). The
   plan lives in `decomposition-pattern/lab-test-redesign/`.
3. **Harness regression.** The Playwright runner at `harness/run.ts`
   exercises ten case files in `experiments/` covering every
   hydration boundary identified in Stream A's empirical map.

The lab is general-purpose. New work in either stream can author new
experiments against the same target without disturbing existing tests.


File tree
---------

    edge-del-v2/
    ├─ README.md                              this document
    ├─ INDEED-MIGRATION-BRIEFING.md           customer-facing kickoff memo for the
    │                                            Indeed Performance Edge → Edge
    │                                            Delivery migration conversation
    ├─ optimizely_guidance.txt                source customer guidance (the GitLab
    │                                            document that seeded Stream A)
    │
    ├─ reinforcement-layer/                   Stream A
    │  ├─ CUSTOMER-GUIDE.md                      authoritative architecture + install
    │  ├─ FINDINGS.md                            empirical hydration map
    │  ├─ PLAYBOOK-V2.md                         operational runbook
    │  ├─ customer-email.md                      customer-facing summary email
    │  └─ research-clientside-api.md             Optimizely client-side JS API ref
    │
    ├─ decomposition-pattern/                 Stream B
    │  ├─ VARIATION-DECOMPOSITION-GUIDE.md       the pattern reference
    │  ├─ indeed-pricing/                        Indeed's variation, decomposed
    │  │  ├─ README.md                              walkthrough of the four changes
    │  │  ├─ resolve.js                             template-literal resolver
    │  │  ├─ change-1-insert-html.html              54 KB resolved HTML payload
    │  │  └─ change-4-custom-code.js                behaviour shell
    │  └─ lab-test-redesign/                     synthetic test of the pattern
    │     ├─ README.md                              test plan + validation steps
    │     ├─ change-1-insert-html.html              ~7 KB lab-pricing payload
    │     └─ change-4-custom-code.js                accordion wiring
    │
    ├─ target-app/                            shared lab — Nuxt 3.21 / Vue 3.5 SSR
    │  ├─ nuxt.config.ts
    │  ├─ app.vue
    │  ├─ pages/                                 5 SSR pages
    │  ├─ components/                            5 components covering hydration
    │  ├─ server/edge-entry.ts                   Pages-integrated worker entry
    │  └─ build-pages.mjs                        post-build esbuild pipeline
    │
    ├─ edge-worker/                           shared lab — standalone worker
    │                                            (legacy mode B for comparison)
    │
    ├─ reinforce/                             shared lab — companion package
    │  ├─ build.mjs                              esbuild → companion.min.js
    │  └─ src/
    │     ├─ companion.ts                        browser IIFE
    │     ├─ ops.ts                              six op primitives
    │     └─ types.ts                            shared types
    │
    ├─ experiments/                           shared lab — 10 case files (mode B)
    ├─ harness/                               shared lab — Playwright runner
    ├─ runs/                                  shared lab — timestamped outputs
    │
    ├─ package.json  package-lock.json  node_modules/
    └─ .gitignore


Where to start
--------------

  If you're working on Stream A (the reinforcement layer):
    → `reinforcement-layer/CUSTOMER-GUIDE.md` is the entry point.
    → For day-to-day ops, `reinforcement-layer/PLAYBOOK-V2.md`.
    → For empirical hydration data, `reinforcement-layer/FINDINGS.md`.

  If you're working on Stream B (the decomposition pattern):
    → `decomposition-pattern/VARIATION-DECOMPOSITION-GUIDE.md` is the
       pattern reference.
    → For the Indeed worked example,
       `decomposition-pattern/indeed-pricing/README.md`.
    → For validating the pattern against our lab,
       `decomposition-pattern/lab-test-redesign/README.md`.

  If you're deploying / running the lab:
    → `reinforcement-layer/PLAYBOOK-V2.md`. The lab serves both streams.

  If you're orienting yourself for the first time:
    → This document. Then pick a stream above.

  If you're preparing for the Indeed kickoff conversation:
    → `INDEED-MIGRATION-BRIEFING.md`. Customer-side framing for the
       Performance Edge → Edge Delivery migration — what Indeed
       engineering owns, what Optimizely owns, the talking-points
       strip, the open questions, and one-sentence answers to the
       likely customer questions.
