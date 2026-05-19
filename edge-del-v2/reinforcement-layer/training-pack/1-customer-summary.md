# For the customer — what this is, and what your team has to do

You run an SSR site on a hydrating framework (Vue 3 / Nuxt 3,
React 18 / Next.js, or similar). You use Optimizely Edge Delivery to
apply experiments at the CDN. The variation arrives in the SSR
response — but the framework's hydration step on the browser side can
silently undo it. This pack ships a one-time install that fixes that,
permanently, for every experiment.

## What changes for your experimentation team

Before: most variation types had to be routed through the client-side
snippet because edge-delivered variations didn't survive hydration.
Engineers and the experimentation team had to know which change types
were "safe at the edge" and which weren't.

After: every change type ships at the edge. View Source shows the
variation. First Contentful Paint includes it. Crawlers see it. SPA
navigation preserves it. The experimentation team stops worrying
about activation routing.

## What your engineering team has to do (one-time)

Two install points, both implemented in our reference lab and ready to
copy:

1. **Edge worker** — wrap the existing `applyExperiments()` call so
   the worker also emits a small inline `<script>` (the *companion*)
   into the response body. ~50 lines, lives next to your existing
   worker code.

2. **Browser** — nothing to install if you accept the inline-script
   approach (the worker delivers the companion in the SSR response).
   If your CSP forbids inline scripts, install one npm package and
   add one `<script>` tag.

Engineer-facing details in `2-engineering-handbook.md`. The work is
under a day for a senior engineer who has touched your edge worker
before.

## What you get back

- Variation visible at first paint on every page, including pages
  that previously required client-side activation.
- Variation survives SPA navigation (router pushes don't lose it).
- One install. No per-experiment ceremony.
- Zero extra HTTP requests — the companion ships inside the HTML
  response your worker already returns.
- Bundle cost: under 2 KB gzipped.

## Ongoing maintenance

Effectively none. The companion is generic — it replays whatever ops
the manifest contains. New experiments need no additional client
code. Optimizely's manifest publishing flow is unchanged.

The two scenarios where engineering would re-engage:

1. You upgrade to a new SSR framework not covered by the bundled
   adapters. Add one new adapter file (~20 lines). Pattern documented
   in `2-engineering-handbook.md` § "Adding a new framework adapter."

2. You change your edge worker entry point. Re-apply the wrapper.
   ~5 minutes.

## When to call Optimizely back

- A specific experiment misbehaves after install — usually an
  activation-type issue (the experiment was authored to run
  client-side; the edge worker correctly skips it). The
  Solutions Architect document covers diagnosis.
- You want the React / Next.js or Svelte adapter and don't have one
  bundled.
- Your bundle size or CSP requirements change and the install method
  needs to be revisited.

## What this is NOT

- **Not a replacement for the snippet on non-SSR or non-hydrating
  pages.** Pages that don't hydrate don't have a hydration problem;
  this work doesn't affect them.
- **Not a fix for misconfigured experiments.** If an experiment is
  authored with `activation_type: "dom_changed"`, the edge worker
  skips it entirely — this pack doesn't change that. Your
  Solutions Architect can audit your existing experiments for this
  pattern.
- **Not a routing decision.** You don't choose per-experiment any
  more. Every experiment ships at the edge.
