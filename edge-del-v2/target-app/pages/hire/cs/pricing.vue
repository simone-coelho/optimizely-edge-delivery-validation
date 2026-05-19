<script setup lang="ts">
// Lab target for the Indeed-pattern decomposition test.
// Path mirrors Indeed's exact production path so the lab-emulation test
// reads as 1:1 with the real customer setup.
//
// The page is deliberately sparse — a header with the structural anchors
// the variation expects, a placeholder main where Change 1 (Insert HTML)
// will inject 54 KB of pricing content, and a footer. Everything the
// variation needs to reach is present here:
//
//   [data-tn-section="header"]       — Change 3 (rearrange) moves this
//   .hasTransparentGnavBackground    — Change 2 (class remove) targets this
//   <main>                            — Change 1 (Insert HTML) targets this
//   .opt-moo-1399                     — created by Change 1's HTML, used
//                                        by Change 3 as the rearrange target
//
// On a real customer site this content would be authored from the CMS.
// For the lab we keep it minimal so the variation's content is what
// dominates the post-variation DOM, matching Indeed's situation where
// the pricing page is essentially shell + variation.

useHead({
  title: 'Lab — Indeed pattern (placeholder)',
  bodyAttrs: { class: 'hasTransparentGnavBackground' }
})

// The customer's source code has no variation-specific CSS. The
// variation's styling is authored in Optimizely as a `custom_css`
// change on the variation (see
// `decomposition-pattern/lab-indeed-emulation/change-5-custom-css.css`
// and `add-custom-css-change.py`). This mirrors how a rapid-
// experimentation engineer works against a real customer account:
// nothing experiment-specific touches the customer's codebase.
</script>

<template>
  <div class="hire-cs-pricing" data-tn-page="/hire/cs/pricing">
    <header
      data-tn-section="header"
      class="hasTransparentGnavBackground"
      style="padding: 1.5rem; border-bottom: 1px solid #e5e7eb; background: rgba(255,255,255,0.6);"
    >
      <div style="max-width: 1200px; margin: 0 auto; display: flex; align-items: center; gap: 2rem;">
        <span style="font-weight: 700;">Lab Co. Pricing</span>
        <span style="color: #6b7280; font-size: 0.875rem;">
          Placeholder header — the variation will rearrange this to appear
          above the inserted pricing block.
        </span>
      </div>
    </header>
    <!-- Deliberately omitting `data-allow-mismatch` here so the lab
         can demonstrate, side-by-side, what Vue 3.5's hydration
         recovery does to an edge-injected variation when the companion
         is not present (open the URL with `?reinforce=off`). The
         companion is the load-bearing piece for the production
         pattern; the dev-mode warning suppression
         `data-allow-mismatch` offers is documented in
         reinforcement-layer/CUSTOMER-GUIDE.md section 11 as a useful
         defence-in-depth, but visibility of the failure mode matters
         more than ergonomics for the training lab. -->
    <main>
      <div data-tn-section="main" style="max-width: 1200px; margin: 4rem auto; padding: 0 1.5rem; text-align: center;">
        <h1 style="font-size: 2rem; font-weight: 600; margin: 0 0 1rem;">
          Hire on Lab Co.
        </h1>
        <p style="color: #6b7280; font-size: 1rem; margin: 0;">
          The Indeed-pattern variation replaces this placeholder with 54 KB of
          pricing content (tier cards, comparison table, FAQ, hire-more,
          explore-more) inserted at the edge by Optimizely Edge Delivery.
        </p>
        <p style="color: #6b7280; font-size: 0.875rem; margin: 2rem 0 0;">
          With the experiment active you should not see this paragraph — the
          inserted content lands at <code>afterbegin</code> of
          <code>&lt;main&gt;</code> and visually replaces it.
        </p>
      </div>
    </main>
  </div>
</template>
