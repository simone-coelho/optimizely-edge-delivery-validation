# Optimizely Web Snippet + Reinforcement — SuiteCommerce Advanced Pack

**Audience.** Mystery Ranch engineering (SuiteCommerce Advanced, Backbone)
running the standard Optimizely Web Experimentation snippet. No Edge
Delivery; no SDK; just `optimizely.js` plus a small companion file
that survives Backbone's view swaps.

Seven documents and one folder of drop-in source. Read `0-` first.

```
0-suitecommerce-context.md       ← READ FIRST. What SCA is, what makes
                                   it different from a "normal" snippet
                                   deployment, why this guide exists.
                                   ≈ 1 page.

1-snippet-placement.md           ← Where in the SSP template the snippet
                                   goes. Sync, top of <head>. Why never
                                   via GTM on this platform. ≈ 1 page.

2-three-failure-modes.md         ← The three things that go wrong on a
                                   Backbone SPA when you run Optimizely
                                   Web: timing, SPA navigation, section
                                   re-render. With the fix for each.
                                   ≈ 3 pages.

3-companion-installation.md      ← The drop-in: copy four files, drop
                                   in the SuiteCommerce init snippet,
                                   verify in DevTools. ≈ 2 pages.

4-checkout-safety.md             ← How to keep variations away from
                                   native checkout validation. ≈ 1 page.

5-revenue-tracking.md            ← LiveOrder.Model read on the
                                   Thank-You page, dedup on refresh,
                                   push into Optimizely. ≈ 2 pages.

6-decomposition-not-custom-code.md ← Why Custom Code variations can't
                                   be reinforced safely on Backbone, and
                                   how to decompose into Visual-Editor
                                   primitives that can. ≈ 1 page.
```

The drop-in source folder is self-contained:

```
code/
├── README.md                    ← file-by-file walkthrough
├── companion.ts                 ← extract+replay engine (shared with
│                                  Edge Delivery pack; vendored here)
├── ops.ts                       ← DOM primitives
├── types.ts                     ← Op vocabulary
├── suitecommerce-init.ts        ← SCA config (framework: backbone,
│                                  region roots, checkout skip)
└── revenue.ts                   ← LiveOrder.Model → Optimizely
                                    revenue event helper
```

Mystery Ranch receives THIS folder (the entire `snippet-pack/`). No
external references; no need to grab files from elsewhere in the
repo. The companion engine files are vendored copies of the shared
engine that also ships in `../training-pack/code/`; the duplication
is intentional so the deliverable is self-contained.

## What this pack is NOT

- Not Edge Delivery. If you want Edge Delivery, see `../training-pack/`.
- Not the long-form architecture reference. That's
  `../CUSTOMER-GUIDE.md`. Read this pack first; only go to the
  CUSTOMER-GUIDE if a specific question goes unanswered.
- Not a Backbone tutorial. It assumes you know what
  `Backbone.history`, `Backbone.View`, and `LiveOrder.Model` are
  in the SCA codebase.
