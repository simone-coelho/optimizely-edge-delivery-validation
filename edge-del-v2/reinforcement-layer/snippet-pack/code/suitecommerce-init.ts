// SuiteCommerce Advanced — companion configuration shim.
//
// Pasted into Optimizely's Project JavaScript pane BEFORE the
// companion IIFE, or loaded as the first JS file in an SCA extension
// alongside the companion source.
//
// Purpose: set window.__EDGE_DEL_V2_CONFIG__ so the companion's adapter
// auto-selection picks the Backbone adapter and uses the right list
// of region root selectors for in-place re-render observation.
//
// Auto-detection in the companion would probably pick `backbone`
// anyway (it checks for window.Backbone.history first), but the
// explicit pin removes any race against snippet load order — the
// config is set before the companion IIFE runs, so selectAdapter()
// finds the explicit framework name immediately.
//
// See ../3-companion-installation.md for installation paths.
// See ../2-three-failure-modes.md for what the regionRoots are.
// See ../4-checkout-safety.md for why we conditionally clear
// regionRoots on the checkout flow.

(function () {
  // Suppress the companion on the checkout application. The snippet
  // and DSW still run; the companion's view-swap observer does not.
  // If the customer opts a specific experiment INTO checkout, the
  // route-change apply still works, but no in-place re-render
  // reinforcement is installed.
  var onCheckout = /\/checkout(\/|$|\?)/.test(window.location.pathname);

  var regionRoots = onCheckout
    ? []
    : [
        '#main-content',          // the big one — every route swaps this
        '#mini-cart',             // slide-out cart panel
        '#cart-summary',          // cart subtotal/total area
        '#facets-sidebar',        // search/PLP facet filter
        '#product-grid',          // search/PLP results grid
        '#header-promotional-banner'  // header banner re-renders
      ];

  (window as any).__EDGE_DEL_V2_CONFIG__ = {
    framework: 'backbone',
    regionRoots: regionRoots,
    rerenderDebounceMs: 75
  };
})();
