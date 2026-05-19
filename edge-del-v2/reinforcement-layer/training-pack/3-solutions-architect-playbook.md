# Solutions Architect playbook — running the engagement

You are the Optimizely SA bringing this pattern to a customer. This
document is your end-to-end playbook: discovery, the exact code to
hand to each side, validation, and the failure modes you'll see in
the field.

The customer's reading is `1-customer-summary.md`.
Their engineers' reading is `2-engineering-handbook.md`.
Your job is to coordinate the two.

---

## Section A — Is this engagement the right fit?

Run through this checklist before scoping the work. Two minutes.

| Question                                                          | Disqualifies if … |
| ----------------------------------------------------------------- | ----------------- |
| Does the customer run an SSR site?                                | No → not needed.  |
| Does the framework hydrate? (Vue/Nuxt, React/Next, Svelte/Kit)    | No → not needed.  |
| Does the customer already use Optimizely Edge Delivery?           | No → onboard them to Edge Delivery first, then come back. |
| Does the customer's edge worker run inside their CI/CD pipeline?  | No (e.g. they use a hosted service that doesn't expose worker entry) → install path is harder; talk to product. |
| Has the customer reported any of: variation flicker, variation lost on SPA navigation, can't ship insertion changes at the edge, has to route additive changes client-side? | These are the exact symptoms this pack fixes. Strong fit. |

Strong-fit examples we have already validated:
- **GitLab** — Vue 3 / Nuxt 3, edge worker on Cloudflare. Reference
  install for this whole pack.
- **Indeed** — similar stack. Indeed-pattern decomposition lives next
  to this work in `decomposition-pattern/lab-indeed-emulation/`.

---

## Section B — Discovery questions to ask before kickoff

Ask the customer's engineering lead, not the experimentation team.
Have answers in writing before any code touches the worker.

1. **Which SSR framework, exact version?** ("Nuxt 3.21, Vue 3.5.33"
   is precise enough. "Vue 3" is not.)
2. **Where does the edge worker live?** File path in their repo.
3. **What snippet ID?** They have one per Optimizely project.
4. **Is there a CSP on the SSR response?** If yes, get the
   `Content-Security-Policy` header verbatim. Determines whether
   Part 2 of the engineering handbook uses inline-script, nonce, or
   asset path.
5. **What's the SPA router?** (Nuxt Router, React Router, Next.js
   App Router, etc.) Confirms the framework adapter will work.
6. **Do experiments currently use `activation_type: "dom_changed"`?**
   If yes, those experiments are NOT going to start running at the
   edge after this install — they were always client-only, and the
   edge skips them by design. The customer needs to know this before
   they expect improvement on those specific experiments. See
   § "VMAP empty" below.

---

## Section C — Pre-install audit on Optimizely-side

Before engineering touches anything, do this audit yourself. Five
minutes via REST API or the Optimizely UI.

1. **List the customer's running experiments.** For each, note
   `activation_type` on the targeting Page object. Anything set to
   `dom_changed` will not run at the edge — flag those for the
   customer.
2. **Check for `element_present` URL conditions.** The Visual Editor
   adds these silently when an experiment uses `rearrange` or has
   "wait for element" dependencies. They force `dom_changed`.
   PATCH them out via REST if the customer wants those experiments
   to be edge-eligible.
3. **Pause + restart any experiment you re-target to `immediate`.**
   The CDN manifest doesn't republish on conditions-only edits;
   a pause/start cycle forces it.

This audit is documented in detail in
`reinforcement-layer/CUSTOMER-GUIDE.md` § 9.1 ("activation_type
gotcha"). Ship a copy of that section to the customer's
experimentation team — they're the ones authoring future experiments
and they need to know about it.

---

## Section D — The deployment, side by side

This is the part you walk through with engineering on the call.
Open the engineering handbook in one window, this playbook in
another.

### The edge worker side

There is no npm package. The reference implementation ships as six
plain files in this same training pack at
`reinforcement-layer/training-pack/code/`. The engineer's job is to
vendor those six files into the customer's repo and wire one
function call.

The engineer will:

1. **Copy the `code/` folder** into the customer's source tree
   (typically `src/optimizely-companion/`).
2. **Install esbuild** (`npm install --save-dev esbuild`).
3. **Run `node build-companion.mjs`** in the copied folder to
   produce `companion.min.js` and `companion-source.mjs`.
4. **Wire `handleRequestWithReinforcement` into the customer's
   existing worker `fetch` handler.** Three-line change.

The wiring snippet they paste into the customer's worker entry
(reproduced here so you can read it to them on the call):

```ts
import { handleRequestWithReinforcement } from './optimizely-companion/worker-integration';
import { COMPANION_SOURCE }                from './optimizely-companion/companion-source.mjs';

(globalThis as any).COMPANION_SOURCE = COMPANION_SOURCE;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handleRequestWithReinforcement(
      request,
      env,
      ctx,
      (req) => yourSsrHandler.fetch(req, env, ctx)  // their existing SSR fetcher
    );
  }
};
```

The actual wrapper logic — the `applyExperiments()` call, the body
scan for `data-optly-<id>` markers, the manifest fetch, the
companion injection — all lives inside
`code/worker-integration.ts`. Engineers read it once to confirm
what it does, then treat it as a black box.

Point the engineer to `target-app/server/edge-entry.ts` in this
repository if they want a complete working worker as reference. The
lab version has extra training-mode scaffolding (a `?reinforce=off`
kill switch, a `?variation=off` toggle, lab-specific Nuxt nitro
plumbing) — `code/worker-integration.ts` is the same logic with
that scaffolding stripped out.

### The client / browser side

The engineer is going to:

1. **Probably do nothing.** If they accepted inline-script in the
   worker, the companion already ships in the response body. No
   bundler change, no script tag, no npm install on the client.

2. **OR, if CSP forbids inline scripts:** copy the companion to
   their static assets and reference it via `<script src>`. Tell
   them in advance which case applies based on the CSP header you
   captured during discovery (Section B, question 4).

There is no third option. The companion is browser-only JS — it
doesn't need a build step, it doesn't need framework integration
code in user-land, it doesn't ask the customer to call any function.
It reads the inline manifest, waits for the framework's mount signal
via the bundled adapter, and replays the ops.

---

## Section E — Validation walkthrough

Run this with the engineer on the deployment call. Have a page open
in a browser, DevTools open.

1. **Headers.** Network tab → click the document request → Response
   Headers → confirm `x-edge-del-v2` appears and includes
   `reinforce=on`.

2. **Inline manifest.** View Source → Ctrl-F →
   `edge-del-v2-manifest`. Confirm a JSON payload with `ops`. If
   `ops` is empty: VMAP miss (see Section F).

3. **Companion presence.** Console → `__EDGE_DEL_V2__` → confirm
   the events log contains:
   - `boot:armed`
   - `route:history-patched`
   - `hydration:nuxt-hook-armed` (or framework equivalent)
   - `initial:applied`

4. **Variation persists post-hydration.** Inspect an element the
   variation modified. It should carry `data-edge-applied="…"`.

5. **SPA navigation works.** Click a same-origin link → wait → use
   the back link → confirm the variation is still applied.
   `__EDGE_DEL_V2__.events` should show `route:applied` events
   firing on every router push.

If all five pass, the install is good. Ship the diagnostic checklist
above (steps 1-5) to the customer as the runbook their support team
should use when an experiment is reported broken.

---

## Section F — Common pitfalls in the field

### "VMAP is empty, view source has no variation"

Most common diagnosis: the experiment's targeting Page has
`activation_type: "dom_changed"`. The edge worker correctly skips
it. No amount of installation work changes this.

Diagnose:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://api.optimizely.com/v2/pages/<pageId> | jq .activation_type
```

If `"dom_changed"`: PATCH it to `"immediate"`, audit the page's
`conditions` for an `element_present` clause (remove it if found),
then pause + restart the experiment to flush the manifest.

### "Variation flickers on initial load"

Expected when Vue 3.5 hydrates a page where the SSR DOM differs
from the vDOM. The companion catches the recovery and re-applies,
but there's a single-frame window where Vue may show the original.

Mitigation: have the customer add `data-allow-mismatch="children"`
on the exact element whose children the variation modifies (Vue 3.5+
only). Documented in `CUSTOMER-GUIDE.md` § 11. Not a defect — a
known characteristic.

### "Variation present cold, gone after SPA navigation"

Companion's history-API hook didn't install. Causes:

- Page is using a non-standard router that doesn't go through
  `history.pushState`. Confirm with the engineer.
- Bundle includes the companion but it didn't run (CSP blocked it).
  Check `__EDGE_DEL_V2__` — undefined means the script didn't
  execute.
- Customer's app calls `window.history.pushState` directly without
  the router seeing it. The companion intercepts these globally, so
  this case is rare but possible.

### "[Vue warn] Hydration text content mismatch"

Expected. This is what the companion exists to recover from. Tell
the customer's eng team in advance — they will see this warning
in dev builds for every page with an edge variation, and it is not
a defect.

### "Edge worker timing out on cold start"

The `buildOpsFromManifest()` call fetches `cdn.optimizely.com` to
read the manifest. First request on a cold worker takes 50-200ms
extra. Aggressive caching in the package mitigates after warm-up.
If timing is a hard concern, expose the manifest as a Cloudflare KV
value pre-warmed by a cron — talk to product before going down this
path; it shouldn't be necessary.

### "CSP blocked the companion `<script>`"

Discovery question 4 should have caught this. If you missed it:
flip to the asset-path install (engineering handbook § "Part 2,
Choice B"). Adds one static file to the customer's public assets,
swaps the worker's injection to a `<script src>` tag. Five-minute
change.

---

## Section G — Where to point each role for deeper context

| If the reader asks about …                              | Send them to … |
| ------------------------------------------------------- | -------------- |
| The empirical hydration map (what change types survive natively, what doesn't) | `CUSTOMER-GUIDE.md` § 3 |
| The exact SDK-side change to land in `@optimizely/edge-delivery` | `CUSTOMER-GUIDE.md` § 7 |
| Authoring guidance for the experimentation team         | `CUSTOMER-GUIDE.md` § 9 (especially § 9.1 — `activation_type` gotcha) |
| Custom-code-to-decomposed-changes refactor (the "Indeed" pattern) | `decomposition-pattern/lab-indeed-emulation/README.md` |
| The 3-mode training demo for engineers                  | `decomposition-pattern/lab-indeed-emulation/README.md` § "Training the engineers" |
| Productisation roadmap (Optimizely product)             | `CUSTOMER-GUIDE.md` § 12 |
| Known limitations                                       | `CUSTOMER-GUIDE.md` § 11 |

---

## Section H — Engagement timeline (for sizing the work)

| Phase                                            | Owner                                | Effort     |
| ------------------------------------------------ | ------------------------------------ | ---------- |
| Discovery & pre-audit                            | SA                                   | 1-2 hours  |
| Authoring-team briefing on `activation_type`     | SA + customer experimentation lead   | 30 minutes |
| Engineering kickoff (walk through the handbook)  | SA + customer eng lead               | 1 hour     |
| Edge worker install                              | Customer engineer                    | 2-4 hours  |
| Companion verification + 5-step validation       | SA + customer engineer               | 30 minutes |
| Post-install monitoring (1 week)                 | SA + customer ops/support            | passive    |
| **Total active engineering time on customer side** |                                    | **< 1 dev-day** |

If the engagement runs longer than this, it's almost always because
of the `activation_type` audit revealing a stack of existing
experiments that need to be re-targeted. That's customer-side
experimentation work, not engineering work.
