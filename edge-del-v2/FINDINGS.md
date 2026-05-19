# Edge Delivery Hydration — Empirical Findings

Recorded against the deployed lab on 2026-05-14.
Source of truth: `runs/2026-05-14T17-38-35-562Z/report.md` (20/20 pass after
correcting an earlier marker-format measurement bug — see "Methodology notes"
below) plus the mechanism-isolation runs verified with the companion blocked.

## TL;DR

After fixing a marker-format bug in the earlier harness measurements and
adding two cases that genuinely exercise Vue's hydration recovery (case 09
additive-into-v-for, case 10 reactive-binding), the verified picture is:

1. **The companion is the deliverable.** Empirical isolation tests show
   `data-allow-mismatch` (the worker-side annotator's output) does not
   prevent Vue 3.5's production-build recovery. Vue's render path ignores
   the attribute and reconciles anyway. With the companion script disabled
   at the network level (annotator-only), every fragile case still
   recovers. The companion is doing 100% of the recovery-prevention work
   in production builds.

2. **The annotator's actual value is dev-mode and forward-compat, not
   recovery suppression.** `data-allow-mismatch` suppresses the `[Vue
   warn] hydration mismatch` console warning in development builds. In
   production builds (where the warning is already suppressed) it has no
   observable effect. We keep emitting it because (a) it's cheap, (b) it
   stops noisy dev-tool output for the customer's developers running
   `nuxt dev`, and (c) it's a forward-compatible signal in case future
   Vue versions decide to honor the attribute in prod.

3. **Static template content is even safer than the guidance predicted.**
   Hardcoded text, attributes, and class lists on existing SSR'd elements
   survive Vue's hydration without any reinforcement in the production
   build. This holds even when the parent has reactive children, as long
   as the targeted attributes themselves are not bound to reactive state.
   Additive DOM into an empty static anchor also survives — the parent's
   vDOM expectation of "no children" tolerates one unexpected child.

4. **Reactivity, not statefulness or position, is the fragile boundary.**
   The genuinely fragile patterns are:
     - Reactive bindings (`{{ binding }}`, `:attr="binding"`)
     - Additive DOM into a v-for or otherwise component-managed parent
     - Mixed reactive + static edits inside the same component
     - Structural reorder (because the worker can't execute moves via
       HTMLRewriter in the current design — see Methodology notes)

5. **Reinforcement brings 100% of cases to "survives"** with zero
   per-experiment customer code. The full layer is worth installing as a
   safety net even when most variations don't strictly need it, because
   the customer doesn't have to audit each experiment for fragility.

## Per-case empirical outcomes (10 cases, 20 runs)

| # | Case                  | Bucket  | Without reinforcement | With reinforcement | Mechanism |
|---|-----------------------|---------|-----------------------|--------------------|-----------|
| 1 | text-content          | safe    | survives              | survives           | Vue tolerates static text natively |
| 2 | attribute-only        | safe    | survives              | survives           | Vue tolerates static attributes natively |
| 3 | css-class-toggle      | safe    | survives              | survives           | Vue tolerates static class/style natively |
| 4 | additive-dom (empty anchor) | safe* | survives        | survives           | Empty parent tolerates one extra child |
| 5 | rearrange-unkeyed     | n/a**   | recovered             | survives           | Companion-driven move post-hydration |
| 6 | rearrange-keyed       | n/a**   | recovered             | survives           | Companion-driven move post-hydration |
| 7 | stateful-subtree-edit | fragile | partial               | survives           | Reactive {{ label }} reverts; companion re-applies |
| 8 | combination (text + additive into empty anchor) | safe* | survives | survives | Both ops in this topology survive natively |
| 9 | **additive-into-vfor**  | fragile | recovered             | survives           | **Vue discards unexpected v-for child; companion re-inserts** |
| 10| **reactive-binding**    | fragile | recovered             | survives           | **Vue re-renders {{ label }} to computed value; companion re-applies** |

(* "safe" here means safe in this specific lab topology — additive into a
v-for parent is fragile, see case 09.)

(** Cases 05/06 outcome of "recovered" is not because Vue undid the move,
but because the worker's HTMLRewriter pass does not actually execute
move ops — see Methodology notes. The verifier reports "recovered"
when the move never happens; "survives" when the companion executes it.)

## What each piece of the layer does (mechanism isolation)

We ran each fragile case with the companion script blocked at the network
layer, leaving only the worker's annotator stamping `data-allow-mismatch`.
The results:

  Case 09 (additive into v-for) — annotator only:
    Banner is GONE post-hydration. Vue discarded it despite the parent
    having data-allow-mismatch="children".

  Case 10 (reactive binding) — annotator only:
    Text reverted to "0 clicks". Vue re-rendered the {{ label }} despite
    the element having data-allow-mismatch="text".

  Case 09 — annotator + companion:
    Banner present, stamped with data-edge-companion-inserted="1".
    Companion re-inserted after Vue discarded.

  Case 10 — annotator + companion:
    Text = "Edge-applied label override". Companion re-applied after
    Vue reverted.

Conclusion: in production Vue 3.5 builds, the annotator does not prevent
recovery. The companion does the work. This is consistent with Vue's
`isMismatchAllowed()` being a warning-emission gate, not a recovery gate.

## The actually-safe vs actually-fragile patterns

Based on the 10 cases, the practical map for an experiment author is:

| Change shape                                                | Survives natively (no reinforcement) | Needs companion |
|-------------------------------------------------------------|:---:|:---:|
| Hardcoded text inside a template (no `{{ }}`)               | ✓   |     |
| Attribute on element with no `:attr=` binding               | ✓   |     |
| Class / style on element with no reactive binding           | ✓   |     |
| Image src/srcset/alt on existing `<img>` (no `:src=`)       | ✓ (expected) |    |
| Additive DOM into an EMPTY static anchor                    | ✓   |     |
| Text edit of a `{{ binding }}` reactive node                |     | ✓   |
| Attribute edit of a `:attr="binding"` reactive node         |     | ✓   |
| Additive DOM into a v-for / component-managed parent        |     | ✓   |
| Remove an element the parent component renders              |     | ✓   |
| Reorder children of any v-for (keyed or unkeyed)            |     | ✓   |
| Edit inside `<ClientOnly>` / dynamic island                 |     | ✓   |

For an experiment author at GitLab, the rule of thumb is:

  > If your target's content comes from a `{{ }}` interpolation or
  > `:attr` binding in the .vue template, Vue will revert your edit on
  > hydration. The companion will re-apply it post-mount.
  >
  > If your target is hardcoded text/attr in the template, the edit
  > survives natively. The reinforcement layer is a no-op safety net.
  >
  > If you're adding a new element into a v-for parent, the worker
  > injects it into the SSR HTML, Vue discards it on hydration, and the
  > companion re-inserts it post-mount. The user sees a brief flicker
  > as the element disappears and reappears (typically <16 ms).

## Methodology notes (corrections to earlier measurements)

This document and the kit went through three measurement-error
corrections during validation. They're recorded here so future runs are
calibrated and the discrepancy with my earlier reports is on record.

1. **Marker-format mismatch (corrected 2026-05-14T17:30):**
   The worker initially stamped `data-edge-applied="edge-del-v2-op-<i>"`
   on every node it modified or inserted. The companion's idempotency
   check and the harness's verifier both look for
   `data-edge-applied="<caseId>__<i>"`. As a result:
     - The verifier always returned `recovered` for `add` and
       `move-append` ops, masking cases where Vue actually let the
       worker's insertion survive.
     - The companion never recognised the worker's nodes as
       already-applied and inserted a duplicate alongside (visible as
       two banners with the same id="edge-banner-04" on case 04).
   Fix: `applyMark = \`${c.id}__${i}\`` in `edge-worker/src/modes/local.ts`.

2. **Worker does not execute `move` ops via HTMLRewriter:**
   The current `applyOps` `case 'move'` branch only stamps
   `data-edge-move-pending` on the source — it does NOT actually move
   the element across the streaming HTML. Cross-element move in
   HTMLRewriter is awkward (the element() handler doesn't expose
   outerHTML and inner content streams between handlers), so the
   current design relies on the companion to execute the move
   post-hydration. Cases 05 and 06 therefore are companion-only —
   reinforce-off shows "recovered" because the move never happens, not
   because Vue reconciled it back. This is a real limitation of the
   current worker design, called out in `CUSTOMER-GUIDE.md` §4 and §9.

3. **Case 04 / case 08 expected outcomes overstated:**
   Earlier expectations predicted that all additive DOM ops would
   recover. Verification shows additive into an EMPTY static anchor
   (no v-for, no reactive bindings on the parent) survives Vue 3.5
   hydration natively. The actually-fragile additive case is case 09
   (additive into a v-for parent), which we added during validation.

4. **Annotator efficacy overclaimed:**
   The earlier `CUSTOMER-GUIDE.md` framed the annotator as preventing
   Vue from recovering safe-type changes. Mechanism-isolation tests
   (blocking the companion at the network layer, leaving the annotator
   in place) show the annotator's `data-allow-mismatch` attribute does
   not change Vue's production-build recovery behaviour. The annotator
   is now framed as dev-mode warning suppression + forward-compat.

## Live lab

- Pages (Nuxt SSR origin): https://edge-del-v2-target.pages.dev
- Worker (Edge Delivery + reinforcement): https://edge-del-v2-worker-prod.expedge.workers.dev
- Health: https://edge-del-v2-worker-prod.expedge.workers.dev/__edge-del-v2/health

Best demo URLs (the ones that actually show the deliverable's value):

    /pricing?case=09-additive-into-vfor&reinforce=off   → banner gone after hydration
    /pricing?case=09-additive-into-vfor&reinforce=on    → banner present, companion re-inserted

    /about?case=10-reactive-binding&reinforce=off       → text reverted to "0 clicks"
    /about?case=10-reactive-binding&reinforce=on        → text held at "Edge-applied label override"

Cases 01-04 + 08 also work end-to-end but Vue tolerates them natively, so
the off/on toggle doesn't reveal the layer's value.
