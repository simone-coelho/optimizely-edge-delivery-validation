# 4 — Checkout safety

The most important page on the storefront has the smallest acceptable
blast radius for experimentation. Treat checkout as a separate, opt-in
experimentation track with its own rules.

## What can break

SCA's checkout flow runs native NetSuite scripts that:

- Validate cart contents against inventory before allowing payment.
- Validate billing/shipping address formats per region/country.
- Validate payment method tokens (credit card, PayPal, gift card).
- Calculate tax based on shipping address.
- Handle the actual order submission to NetSuite ERP.

These scripts react to specific DOM elements and to specific events
on those elements (form submits, blur/change on inputs, click on the
"Place Order" button). A variation that mutates the wrong element or
re-binds the wrong listener can:

| Failure | What the visitor sees | What you lose |
|---|---|---|
| Validation bypass | Form submits with bad data | Failed orders, support tickets |
| Validation lockout | Form refuses to submit | Lost revenue, abandonment |
| Re-binding overwrites native handler | Click does nothing OR fires twice | Lost revenue OR double-charged |
| Tax recalculation breaks | Wrong total displayed | Refunds, accounting reconciliation |

The cost of breaking checkout is real revenue, not a metric. Treat
accordingly.

## Default rule — checkout is excluded

By default, no experiment should be active on the checkout pages
unless you have explicitly opted in.

### How to exclude in the Optimizely UI

For each experiment's URL Targeting:

| Setting | Value |
|---|---|
| Include | Whatever URL pattern you actually want to target |
| Exclude | `*/checkout*` |

For project-level safety, set the same exclusion at the
**experiment level** AND at the **page** level. Defence in depth —
if someone duplicates a page without noticing the exclusion, the
experiment-level one still applies.

### How to exclude in the companion

The companion's `regionRoots` config (from
`suitecommerce-init.ts`) can be split by application:

```js
// suitecommerce-init.ts
const onCheckout = /\/checkout(\/|$|\?)/.test(window.location.pathname);

window.__EDGE_DEL_V2_CONFIG__ = {
  framework: 'backbone',
  regionRoots: onCheckout
    ? []                                              // no observers on checkout
    : ['#main-content', '#mini-cart', '#cart-summary',
       '#facets-sidebar', '#product-grid'],
  rerenderDebounceMs: 75
};
```

With `regionRoots: []`, the companion still applies route-change ops
(in case you DO want a variation on the checkout flow — see opt-in
below) but doesn't install any in-place re-render observers. The
checkout's native re-renders don't trigger companion activity.

### Best — don't load the companion on checkout at all

If you're vendoring via the SCA repo (Path B in
`3-companion-installation.md`), simply omit the companion from the
`checkout` application's JS list in `ns.package.json`. The companion
file is never even loaded into the checkout bundle.

If you're using Project JavaScript (Path A), early-return at the top
of the pasted bundle:

```js
// At the very top of the Project JavaScript pane:
if (/\/checkout(\/|$|\?)/.test(window.location.pathname)) {
  // Snippet still loads; companion does not initialize.
  // Optimizely's Web snippet itself is still active for tracking
  // but no variation reinforcement happens.
} else {
  // ...the rest of the Project JS code (config + companion) goes here
}
```

## Opting checkout in for a specific experiment

When you genuinely want to test something on the checkout flow:

1. **Scope tight.** The experiment should target one specific
   URL pattern (`*/checkout/shipping*`, not `*/checkout*`), one
   specific element, one specific change. Never a multi-step
   checkout-wide variation.

2. **Use Custom Code with explicit defensive checks.** Not Visual
   Editor element edits. The Custom Code lets you defer until the
   right element is ready and check for the presence of native
   handlers before binding your own:

   ```js
   utils.waitForElement('#some-cta-on-checkout').then(function (el) {
     // Defensive: only proceed if native validation has already bound.
     if (!el.dataset.nativeValidationReady) {
       return;  // come back next pass
     }
     // Read-only changes: text, class, style. NOT replacing
     // event handlers.
     el.classList.add('experiment-variant-emphasis');
   });
   ```

3. **No `insert_html` or `attribute: { html }` on checkout.** Those
   wholesale-replace DOM, which guarantees you break the native
   handlers bound to it.

4. **No `rearrange`-type changes on checkout.** Officially unsupported
   on dynamic websites (per *Dynamic websites and SPAs*), and high
   risk on checkout specifically.

5. **Test on the staging storefront** with the experiment **forced
   to the variation** via:

   ```
   ?optimizely_x_<experimentId>=<variationId>
   ```

   Place at least 10 successful test orders. Confirm:
   - Order goes through with correct total.
   - Tax recalculates correctly when shipping address changes.
   - Payment method validation triggers correctly with a deliberately
     bad card number.
   - Inventory check works (try a sold-out SKU).

6. **Roll out to 5% traffic first**, watch for 48 hours, look for:
   - Increase in payment errors in NetSuite order logs.
   - Increase in abandoned cart rate.
   - Decrease in average order value (a tax bug shows up here).
   - Support tickets mentioning checkout.

   Only then expand to 50%.

7. **One checkout experiment at a time.** No multi-variate / multi-page
   conflicts on the most fragile flow.

## What to flag to the customer

Mystery Ranch engineering should know:

- The default install of this pack does NOT run on checkout.
- Optimizely's Web Experimentation is fully capable of running
  experiments on checkout — but the engagement scoping treats
  checkout as a high-QA, manual-review track.
- Revenue tracking (`5-revenue-tracking.md`) reads from the
  Thank-You page AFTER order completion. It does NOT modify anything
  in the checkout DOM and is safe to run.
- Promo banner / upsell experiments on the cart page are fine — cart
  is not checkout. The risk concentrates on the actual checkout flow
  (shipping/billing/payment/review/submit).

## A short list of things to never test on checkout

Independent of how careful the implementation is:

| Don't test | Reason |
|---|---|
| Rearranging checkout steps | Breaks the state machine |
| Replacing the "Place Order" button | Breaks the submit handler |
| Modifying payment method UI | Breaks tokenization |
| A/B'ing tax display logic | Customer trust issue if wrong |
| Hiding the order summary | Trust + chargeback risk |
| Replacing input field markup wholesale | Breaks native validators |

A/B testing copy, headlines, microcopy on confirmations, or a single
ungated trust badge — those are fine within the rules above.
