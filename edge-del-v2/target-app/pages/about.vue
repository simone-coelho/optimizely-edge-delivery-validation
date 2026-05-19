<template>
  <div class="page-about">
    <h1 id="about-page-title">About Lab Co.</h1>
    <p class="lead" id="about-page-lead">
      A controlled fixture for validating Edge Delivery against Vue hydration.
    </p>
    <section>
      <h2 class="section-title">Stateful subtree (intentional)</h2>
      <p>
        The counter below is a stateful Vue child. Edge-applied edits inside
        this subtree are the most fragile case in the guidance — they touch
        a component that carries its own hydration expectations.
      </p>
      <StatefulCounter id="about-counter" />
    </section>
    <div class="banner-anchor" data-edge-anchor="about-banner"></div>
  </div>
</template>
