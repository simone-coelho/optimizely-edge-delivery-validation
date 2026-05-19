<template>
  <div id="app" data-fixture-id="edge-del-v2-target">
    <header class="site-header">
      <nav class="site-nav">
        <NuxtLink to="/" class="brand">Lab Co.</NuxtLink>
        <ul class="nav-links">
          <li><NuxtLink to="/">Home</NuxtLink></li>
          <li><NuxtLink to="/pricing">Pricing</NuxtLink></li>
          <li><NuxtLink to="/features">Features</NuxtLink></li>
          <li><NuxtLink to="/about">About</NuxtLink></li>
          <li><NuxtLink to="/blog">Blog</NuxtLink></li>
        </ul>
      </nav>
    </header>
    <!-- The site shell uses <section role="main"> rather than <main>
         so each page can own its own <main> element. Customer variations
         frequently target `selector: "main"` (Indeed's pricing variation
         does this); if the shell were a <main> too, the variation would
         hit the shell instead of the page's content and Vue's hydration
         recovery would tear everything down. -->
    <section class="site-main" role="main">
      <NuxtPage />
    </section>
    <footer class="site-footer">
      <p>Edge Delivery Hydration Lab — fixture <code>edge-del-v2-target</code></p>
    </footer>
  </div>
</template>
