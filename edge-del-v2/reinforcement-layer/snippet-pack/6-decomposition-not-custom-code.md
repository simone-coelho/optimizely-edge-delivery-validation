# 6 — Decomposition wins on snippet-only too

The same decomposition pattern we documented for Edge Delivery
(`../../decomposition-pattern/`) has a separate snippet-only payoff:
**decomposed variations are reinforce-able. Monolithic Custom Code
variations are not.**

## The problem in one sentence

The companion replays a variation's changes by walking the
`changes[]` array on `window.optimizely.get('data').experiments[id].variations[varId].actions[]`
and converting each change to an idempotent DOM operation. Every
change type except one can be replayed safely. The one that can't is
**`custom_code`**.

## Why custom_code can't be safely replayed

A `custom_code` change is arbitrary JavaScript the customer wrote in
the Visual Editor's "Edit Code" panel. The companion has the raw JS
string — it CAN re-execute it on every route change and section
re-render — but doing so re-runs every side effect:

| If the custom code does this | Re-running causes |
|---|---|
| `element.addEventListener('click', f)` | Handler binds twice → onclick fires twice |
| `fetch('/api/log-impression')` | API hit twice (or N times) |
| `el.classList.add('seen')` then later `if (!el.classList.contains('seen')) {…}` | The "first time" branch never runs on re-apply |
| Modifies a global `window.experiment_state` | State machine corrupted |
| Reads then writes the DOM | Doubled mutations on each re-run |

We can't tell from the JS string whether it's idempotent. So the
companion's default behavior with `custom_code` changes is **skip** —
the change is applied once (by Optimizely's snippet on the initial
activation), and the companion never re-runs it on route change or
re-render.

Which means: **a Backbone view swap destroys what `custom_code` did,
and nothing puts it back.**

## The fix — decompose into Visual Editor primitives

The same change, expressed as Visual Editor element edits instead of
Custom Code, IS reinforce-able. Same end result, completely different
runtime story.

### Example — adding a "Free shipping over $50" banner

**Monolithic Custom Code change (BAD on SCA):**

```js
// In the Visual Editor's "Edit Code" panel, custom_code change:
var banner = document.createElement('div');
banner.className = 'free-shipping-banner';
banner.textContent = 'Free shipping over $50';
document.querySelector('#main-content').prepend(banner);
banner.addEventListener('click', function () {
  window.optimizely.push({ type: 'event', eventName: 'banner_click' });
});
```

What goes wrong:
- Backbone re-renders `#main-content` → banner is gone.
- Companion can't safely re-run the JS (would re-bind the click
  handler twice; would re-fetch any API call inside).
- Custom Code is silently dropped from the companion's replay.

**Decomposed Visual Editor changes (GOOD on SCA):**

Three separate Visual Editor changes on the same variation:

1. **Insert HTML** change — selector `#main-content`,
   position `prepend`, value `<div class="free-shipping-banner">Free shipping over $50</div>`.

2. **Attribute change** — selector `.free-shipping-banner`,
   attribute `data-event-binding`, value `banner_click`.

3. **(Project JavaScript, ONE time)** — a global click listener that
   reads `data-event-binding` and dispatches the matching Optimizely
   event:

   ```js
   document.addEventListener('click', function (e) {
     var el = e.target.closest('[data-event-binding]');
     if (!el) return;
     window.optimizely.push({
       type: 'event',
       eventName: el.dataset.eventBinding
     });
   });
   ```

   (Single delegated listener at document level. Fires once per page
   load. Survives every re-render because it's on `document`, not on
   the banner.)

What works now:
- The "Insert HTML" change is type `append` in the Optimizely model.
  The companion handles `append` natively.
- The "Attribute" change is type `attribute` with sub-key `data-event-binding`.
  The companion handles `attribute` natively.
- Backbone re-renders `#main-content` → companion's
  `observeRerenders` fires → companion's `applyForRoute` re-derives
  the ops for this URL → companion re-prepends the banner and
  re-stamps the attribute.
- The delegated click listener was bound once and is still bound.
  Click works.

Same visual result. Survives Backbone view swaps. Reinforce-able.

## The decomposition cheat sheet

| What you wanted to do in Custom Code | Visual Editor equivalent |
|---|---|
| Change text content | "Edit text" change |
| Change a class | "Edit element" → class edit |
| Change an attribute | "Edit element" → attribute edit (href / src / aria-*) |
| Hide an element | "Edit element" → hide |
| Insert a new element | "Insert HTML" change |
| Move an element | "Rearrange" change (NOT on Dynamic Websites — flag this case) |
| Bind a click handler | Insert with `data-event-binding`, single delegated listener in Project JS |
| Track impression of an element | IntersectionObserver in Project JS that reads `data-impression-event` attribute |
| Conditional logic (only show on weekdays) | Audience targeting at experiment level, not in the change |

## When you can't decompose

Some variations genuinely require code. Three-step quizzes,
interactive product configurators, custom validation — these are
real Custom Code use cases. For those:

1. **Wrap the custom code with idempotency guards:**

   ```js
   if (window.__myExperiment_applied) return;
   window.__myExperiment_applied = true;
   // …the actual changes…
   ```

   The first re-run is a no-op. Side effects don't double.

2. **Watch for re-renders explicitly:**

   ```js
   // After the first apply, register an observer that re-runs the
   // SAFE parts (DOM mutations) and skips the UNSAFE parts (event
   // bindings, fetches).
   var safeMutations = function () {
     document.querySelector('.product-grid').classList.add('variation-grid-density');
   };

   safeMutations();
   if (!window.__myExperiment_observer_armed) {
     window.__myExperiment_observer_armed = true;
     new MutationObserver(safeMutations).observe(
       document.querySelector('#main-content'),
       { childList: true, subtree: true }
     );
   }
   ```

3. **Document that this experiment owns its own reinforcement and
   the companion will not back it up.** Note the limitation on the
   experiment in Optimizely's UI Description field.

## Bottom line for Mystery Ranch

Default to Visual Editor primitives. Save Custom Code for the cases
where decomposition isn't possible, and when you use it, write it
defensively (idempotency guards + targeted MutationObserver).

The discipline pays for itself the first time Backbone re-renders the
cart and your "buy 2 get 1" banner doesn't disappear.
