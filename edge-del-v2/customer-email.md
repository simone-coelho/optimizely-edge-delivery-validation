Subject: Edge Delivery + Vue hydration — live demo and approach

[Greeting / address — customise per recipient list]

Following up on the hydration discussion from our recent thread. We've been
experimenting against a small live lab built on a Vue 3 / Nuxt 3 SSR target
that mirrors your stack, and ran a real Optimizely Edge Delivery experiment
through it end-to-end. Two URLs you can open right now, and a short note on
how it works.

Two URLs — same SSR origin, same Visual Editor experiment authored in our
Optimizely project, same Vue 3.5 runtime. The only difference between them
is a small reinforcement layer we're prototyping:

   https://edge-del-v2-target.pages.dev/?reinforce=off
   Edge Delivery applies the variation at the CDN. The additive banner is
   visible at first paint, then Vue's hydration discards it during
   recovery. This faithfully reproduces what you've been seeing on
   additive and hydration-fragile changes.

   https://edge-del-v2-target.pages.dev/?reinforce=on
   Same edge-applied variation, plus the reinforcement. Banner survives
   hydration cleanly.

The implementation is in two pieces.

1. Edge Delivery SDK side — Optimizely-owned. The worker that already
   runs applyExperiments() adds a short post-processing pass: it scans
   the SDK's existing data-optly-<changeId> markers in the response it
   just produced, builds a small JSON manifest of the applied changes,
   and emits it inline before </body>. No extra network requests, no
   manifest re-fetch — everything is derived from what the SDK already
   writes into the response, so the performance characteristics of
   Edge Delivery are preserved. This is the change we'd land in the
   @optimizely/edge-delivery package itself.

2. Customer side — one-time install on your end. A small companion
   script (~4 KB) added to the page, or loaded via your existing
   bundler. On each page load it hooks Nuxt's `app:mounted` lifecycle,
   reads the inline manifest the worker emitted, and idempotently
   re-applies any operations Vue undid during hydration recovery.
   Generic across change types — additive DOM, attribute, class, text,
   reorder — with zero per-experiment authoring overhead.

Once both pieces are in place, the routing decision you've been managing
per experiment (Edge Delivery vs. client-side based on change-type
fragility) effectively becomes a non-decision: every experiment can ship
through Edge Delivery, including the additive and reorder cases that
today need client-side execution.

This is early-stage and a single-experiment proof so far, but the
mechanism is generic. A fuller technical writeup is on its way that will
cover the SDK extension in detail (so both your engineers and ours can
read it from a single document), the customer-side install, and the
cases we've validated. Happy to walk through it on a call once you've
had a look.

Best,
Simone
