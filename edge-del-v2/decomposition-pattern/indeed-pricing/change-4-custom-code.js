// Custom Code for the experiment.
// Paste this verbatim into the Optimizely Visual Editor's Custom Code box.
// Synchronous Timing: Asynchronous.
//
// Replaces the entire original variation's behaviour wiring. No
// waitForElement, no modifyElementWithCallback, no marker classes. The
// edge-applied DOM (Change 1) is already present when this runs.

(function () {
  // FAQ accordion — toggle .active on the question button when clicked.
  document.querySelectorAll('.opt-faq-section button.xds-faq-question-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { btn.classList.toggle('active'); });
  });

  // Checkbox-group exclusivity — selecting one tooltip checkbox closes
  // all others within the pricing and FAQ scopes.
  var scope = function () {
    return document.querySelectorAll(
      '#opt-1445 input[type="checkbox"], #opt1399FAQ input[type="checkbox"]'
    );
  };
  scope().forEach(function (cb) {
    cb.addEventListener('change', function (e) {
      if (e.target.checked) {
        scope().forEach(function (other) { if (other !== cb) other.checked = false; });
      }
    });
  });

  // Click-outside-to-close — any click outside a checkbox or tooltip
  // closes all open tooltips.
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest('input[type="checkbox"]') && !t.closest('.tooltip')) {
      scope().forEach(function (cb) { cb.checked = false; });
    }
  });

  // Comparison-table collapse toggle.
  var collapseBtn = document.querySelector('button.collapse-feature');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', function () {
      var comparison = document.querySelector('#opt-1445 .comparison');
      if (comparison) comparison.classList.toggle('collapsed');
    });
  }
})();
