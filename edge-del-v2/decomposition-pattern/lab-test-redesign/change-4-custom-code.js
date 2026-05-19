// Custom Code — paste verbatim into the Optimizely Visual Editor
// Custom Code change. Synchronous Timing: Asynchronous.
//
// Wires up the FAQ accordion inserted by Change 1. Defensive against:
//
//   1. The element not being in the DOM when Custom Code first runs.
//      Optimizely's snippet activates Custom Code around the same time
//      it applies visual changes; in some race conditions Custom Code
//      may fire a beat before the inserted subtree is fully reachable
//      via querySelector.
//   2. Vue's hydration discarding the entire #lab-redesign subtree (the
//      edge-applied additive content is unexpected by Vue's vDOM and
//      gets removed during hydration recovery). The companion script
//      then re-inserts a FRESH copy with new <button> elements that
//      have no listeners attached. This Custom Code must re-wire those.
//   3. SPA navigation re-rendering the section, possibly multiple times.
//
// Strategy: a MutationObserver on document.body watches for any DOM
// change. Every time mutations are observed, sweep for un-wired FAQ
// buttons and bind the click handler. Idempotent — a `lab-wired-up`
// marker class on each button is the no-op check.

(function () {
  function wireUp() {
    var buttons = document.querySelectorAll('#lab-redesign .lab-faq-question');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (btn.classList.contains('lab-wired-up')) continue;
      btn.classList.add('lab-wired-up');
      btn.addEventListener('click', function () {
        this.classList.toggle('lab-active');
      });
    }
  }

  // First pass — wire immediately if DOM is interactive.
  if (document.readyState !== 'loading') wireUp();
  else document.addEventListener('DOMContentLoaded', wireUp, { once: true });

  // Persistent observer — handles hydration replacement, companion
  // re-insertion, and SPA route changes. Cheapest correct behaviour is
  // to sweep on any mutation and skip already-wired buttons via the
  // marker class.
  if (typeof MutationObserver === 'function') {
    var obs = new MutationObserver(function () { wireUp(); });
    var start = function () {
      obs.observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
