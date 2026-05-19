// Custom Code — paste verbatim into the Optimizely Visual Editor
// Custom Code change. Synchronous Timing: Asynchronous.
//
// Wires up the FAQ accordion inserted by Change 1. The edge-applied DOM
// is already present when this runs. No waitForElement scaffolding.
//
// Idempotent: skips elements that already have a click listener attached
// (marker class lab-wired-up) so SPA navigation or reapply doesn't
// double-bind handlers.

(function () {
  var buttons = document.querySelectorAll('#lab-redesign .lab-faq-question');
  buttons.forEach(function (btn) {
    if (btn.classList.contains('lab-wired-up')) return;
    btn.classList.add('lab-wired-up');
    btn.addEventListener('click', function () {
      btn.classList.toggle('lab-active');
    });
  });
})();
