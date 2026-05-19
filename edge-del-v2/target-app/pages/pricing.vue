<template>
  <!-- Companion-only reinforcement; see comment in hire/cs/pricing.vue
       for why `data-allow-mismatch` is deliberately omitted. -->
  <main class="page-pricing">
    <h1 id="pricing-page-title">Pricing</h1>
    <p class="lead" id="pricing-page-lead">Simple plans for every team size.</p>
    <PricingCards />
    <div class="banner-anchor" data-edge-anchor="pricing-banner"></div>
  </main>
</template>
