# 5 — Revenue tracking on SCA

This is the one place where Optimizely needs to **read** something
from SuiteCommerce: the order total on the Thank-You page, after a
successful checkout, so the experiment's Results page can attribute
revenue to the right variation.

## The model

Optimizely's Web Experimentation tracks revenue as a **custom event**
with a numeric `revenue` field (integer cents). On the Thank-You page,
SCA has just placed the order through NetSuite and has the final
total available on its client-side data model.

```
Visitor completes checkout → Thank-You page loads → SCA has
LiveOrder.Model populated with the final order → companion's
revenue helper reads the total → pushes a single Optimizely
custom event with revenue and a dedup key → Optimizely Results
page shows revenue by variation.
```

## The two rules the Optimizely engine enforces

From the synthetic-data simulator and Optimizely's documented
behavior:

1. **A conversion timestamped before its `campaign_activated` event
   is silently dropped.** The companion's revenue helper fires after
   the snippet has activated, so this is automatic — but if you ever
   delay the helper, mind the ordering.

2. **A future-dated event is rejected.** The helper uses the browser's
   `Date.now()`. Don't paste a hand-edited timestamp.

## Speaking points (from the conversation)

Top to bottom from "nail this down first" to "nice to clarify":

### Questions for Mystery Ranch

1. Which platform exactly — SuiteCommerce or SuiteCommerce Advanced?
   Determines how much we can touch the confirmation page.
2. Do they have a `dataLayer` object on the confirmation page, or are
   we reading straight from `LiveOrder.Model`?
3. Is `LiveOrder.Model` accessible client-side on their build, or has
   it been customized / renamed?
4. What's the order confirmation page structure — single
   "Thank You" page, or a multi-step flow we have to catch?
5. Do they need revenue in Optimizely only, or also reconciled back
   into NetSuite reporting?
6. Currency / tax / shipping — do they want gross order total, net
   of tax, net of shipping? Affects which integer we grab.
7. Any PII or payment data near the value we're extracting that we
   need to stay away from?

### Revenue integration options we actually have

| Option | What it is | When to use |
|---|---|---|
| **A. Backbone model read** | Pull total from `LiveOrder.Model` on confirmation, push via `window.optimizely.push` event API. | Default for SCA. The path this pack documents. |
| **B. Data layer read** | If they maintain a clean `dataLayer.purchase.value` object, grab the value there instead of the raw model. | Cleaner and more stable across SCA upgrades. Use if Mystery Ranch already has a dataLayer. |
| **C. Server-side / NetSuite event hook** | Capture the order server-side and send the conversion via Optimizely's Events API rather than client-side. | If they don't trust client-side firing on checkout. Requires NetSuite SuiteScript work on their side. |
| **D. Edge / SDK-based tracking** | The conversion event fires through the SDK rather than the web snippet. | Only relevant if they ever adopt Feature Experimentation or Edge Delivery. Not in scope for this pack. |

### Safety topics

- Fire the revenue event **after** order confirmation, never inside
  the validation flow.
- **Read-only** on the order object — we extract, we don't mutate
  anything in checkout.
- **Dedup / double-fire protection on page refresh** of the Thank-You
  page. This one is forgotten and quietly corrupts results. Use the
  order ID as the dedup key in sessionStorage.

## The helper — what `revenue.ts` does

```js
trackRevenue({
  // Optional: explicit overrides
  source: 'live-order-model',   // or 'data-layer'
  eventKey: 'revenue',           // the Optimizely event apiName
  currency: 'USD'                // logged for audit, not used in payload
});
```

What it does in order:

1. **Confirm we're on the Thank-You page.** Configurable URL test —
   default checks `/checkout/confirmation` or
   `/checkout/thankyou` (whichever SCA uses on Mystery Ranch).

2. **Confirm `window.optimizely` is initialized.** Wait up to 5
   seconds for `optimizely.initialized === true`.

3. **Read the order ID.** Prefers `LiveOrder.Model.get('confirmation').orderId`,
   falls back to `dataLayer.purchase.transaction_id`, falls back to a
   URL query parameter (`?orderid=`).

4. **Dedup against `sessionStorage`.** If
   `sessionStorage['optly:revenue:<orderId>']` is already set, exit
   without pushing. (Survives page refresh; doesn't survive a new
   browser session, which is fine — that's a different visitor.)

5. **Read the order total.** Prefers `LiveOrder.Model.get('summary').total`,
   converts to integer cents
   (`Math.round(parseFloat(total) * 100)`). Skips if NaN, zero, or
   negative.

6. **Push the event** with `revenue` in cents:

   ```js
   window.optimizely.push({
     type: 'event',
     eventName: 'revenue',
     tags: {
       revenue:   Math.round(total * 100),
       orderId:   orderId,
       currency:  currency
     }
   });
   ```

7. **Stamp the dedup key.**

   ```js
   sessionStorage['optly:revenue:<orderId>'] = '1';
   ```

8. **Log the firing** to `window.__EDGE_DEL_V2__.events` so DevTools
   inspection confirms the push happened.

## Wiring revenue.ts in

The helper is one function exported from `code/revenue.ts`. Wire it
the same way the companion is wired (Project JavaScript paste OR
SCA repo vendor):

### Project JavaScript

Below the companion bundle, append:

```js
// Revenue tracking on the Thank-You page.
// Safe to call on every page — the helper exits early on non-
// confirmation URLs and on duplicate fires.
trackRevenue({
  thankYouUrlPattern: /\/checkout\/(confirmation|thankyou)(\/|$|\?)/
});
```

(You'll need to inline the `trackRevenue` function definition in
Project JS — it's defined in `code/revenue.ts`. Copy the function body
directly into the Project JS pane.)

### SCA repo

Include `revenue.ts` (built to `revenue.js`) in the `checkout`
application's JS list. It runs on the confirmation page automatically
via its own URL test.

## Verifying

Place a test order on the staging storefront. On the Thank-You page,
DevTools console:

```js
window.__EDGE_DEL_V2__.events.find(e => e.kind === 'revenue:pushed')
// → { at: ..., kind: 'revenue:pushed', detail: { orderId: '...', revenueCents: 4995 } }
```

Refresh the Thank-You page. Run the same check:

```js
window.__EDGE_DEL_V2__.events.filter(e => e.kind === 'revenue:pushed').length
// → still 1
```

If you see 2, the dedup is broken. Investigate `sessionStorage`
state — most likely your SCA build isn't preserving sessionStorage
across the page refresh on this domain.

Wait 5-10 minutes, then open the Optimizely experiment's Results
page. Revenue should appear for the visitor (use the experiment's
"View raw events" if available; otherwise wait for the aggregation
to land).

## What happens if the experiment is on the PDP but revenue is on the Thank-You page

That's the normal case. Optimizely's stats engine joins decisions
(impressions) and conversions (revenue events) by `visitor_id`. The
PDP fires the `campaign_activated` event during the visitor's
session. The Thank-You page fires the `revenue` event later in the
same session. Both events carry the same `optimizelyEndUserId`
cookie, so the join works.

This means revenue is attributable **to any experiment the visitor was
in during the session that ended in this order** — not just to a
PDP-specific test. The Results page will show the same revenue
event attributed to every experiment whose impression fired before
the order.

This is also why it's important the snippet runs **on every page**, not
just on pages that have experiments — the impression has to fire on the
page where the experiment is, even if the conversion happens elsewhere.

## What we DO NOT do

- We don't modify anything on the Thank-You page DOM.
- We don't read payment data.
- We don't fire on every page, only on the confirmation page.
- We don't fire if `LiveOrder.Model` isn't populated.
- We don't fire twice for the same order.
- We don't send a future-dated timestamp.
- We don't bypass the dedup.

Read-only, late-fire, idempotent, no PII. That's the contract.
