// Browser-side observer injected via Playwright addInitScript. Captures
// Vue hydration mismatch warnings AND records the DOM state at key
// lifecycle moments so the harness can diff "edge-applied" vs "post-
// hydration" without needing wall-clock timing.
//
// Output is exposed via window.__edgeDelV2Harness for the page-side
// reader.

export const INIT_SCRIPT = `
(function () {
  const bus = (window.__edgeDelV2Harness = {
    vueWarnings: [],
    consoleEvents: [],
    perf: {},
    domSnapshots: {},
    companionEvents: []
  });

  // ── Console capture. Vue 3 dev mode logs hydration mismatches via
  // console.warn with a [Vue warn] prefix. We capture all warns/errors and
  // tag the Vue ones.
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = function (...args) {
    try {
      const msg = args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ');
      const isVue = /\\[Vue warn\\]/.test(msg);
      const isHydration = /hydrat|mismatch|recover/i.test(msg);
      bus.consoleEvents.push({ level: 'warn', at: performance.now(), msg, isVue, isHydration });
      if (isVue || isHydration) bus.vueWarnings.push({ at: performance.now(), msg });
    } catch (_) {}
    return origWarn.apply(this, args);
  };
  console.error = function (...args) {
    try {
      const msg = args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ');
      bus.consoleEvents.push({ level: 'error', at: performance.now(), msg });
    } catch (_) {}
    return origError.apply(this, args);
  };

  // ── Edge-del-v2 companion events ─ relay onto the bus.
  window.addEventListener('edge-del-v2', function (e) {
    try { bus.companionEvents.push({ at: performance.now(), detail: e.detail }); } catch (_) {}
  });

  // ── Performance signal capture.
  if ('PerformanceObserver' in window) {
    try {
      const po = new PerformanceObserver(function (list) {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') bus.perf.fcp = entry.startTime;
          if (entry.entryType === 'largest-contentful-paint') bus.perf.lcp = entry.startTime;
        }
      });
      po.observe({ type: 'paint',                       buffered: true });
      po.observe({ type: 'largest-contentful-paint',    buffered: true });
    } catch (_) {}
  }

  function safeStringify(v) {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
})();
`;
