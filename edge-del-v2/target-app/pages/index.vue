<template>
  <div class="page-home">
    <HeroSection />
    <section>
      <h2 class="section-title" id="features-teaser-title">What we offer</h2>
      <FeatureGrid :limit="3" />
    </section>
    <section>
      <h2 class="section-title" id="pricing-teaser-title">Plans</h2>
      <PricingCards />
    </section>
    <section>
      <!--
        banner-anchor is an empty, server-rendered sibling. Additive-DOM
        experiments target this anchor: they insert a new element here,
        which is exactly the change-class Vue hydration tends to recover
        against on SSR pages. The reinforcement companion re-inserts
        post-hydration.
      -->
      <div class="banner-anchor" data-edge-anchor="home-banner"></div>
    </section>
  </div>
</template>
