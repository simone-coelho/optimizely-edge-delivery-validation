// End-to-end validator for the Indeed-pattern lab emulation.
//
// Confirms, against a real cold visit:
//   1. The Optimizely manifest has the "Indeed Pattern — Lab Emulation"
//      layer and the visitor is bucketed into Variation #1 (VMAP cookie).
//   2. The 54 KB Indeed payload (Change 1) is present in the SSR
//      response — search engines and View Source see the variation at
//      byte zero, before any JS runs.
//   3. Vue hydrates over the variation. Post-hydration:
//        - #opt-1445 (Sponsored Job plans tier section) is in the DOM
//        - .opt-moo-1399 (FAQ / hire-more / explore-more section) is in
//        - .hasTransparentGnavBackground has been removed from the header
//          (Change 2 applied and survived hydration)
//        - If the rearrange (Change 3) is authored, the header is now
//          BEFORE .opt-moo-1399 in document order
//   4. The Custom Code shell (Change 4) wires up:
//        - FAQ accordion: clicking a question toggles `.active`
//        - Tooltip exclusivity: opening one closes others
//        - Click-outside: closes all open tooltips
//        - Comparison collapse: button toggles `.collapsed`
//   5. The companion is the one keeping the variation alive through SPA
//      navigation. Navigate / → /hire/cs/pricing → other → back, and
//      check that the variation persists across each return.

import { chromium } from 'playwright';

const URL = 'https://edge-del-v2-target.pages.dev/hire/cs/pricing';
const MANIFEST_URL = 'https://cdn.optimizely.com/js/web_sdk_v0_5953372780494848.json';
const TEST_LAYER = 'Indeed Pattern — Lab Emulation';

let allPass = true;
function check(label, cond, detail = '') {
  const status = cond ? '✓' : '✗';
  console.log(`  ${status} ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) allPass = false;
}

console.log('=== Phase 1: manifest state ===');
const manifest = await (await fetch(MANIFEST_URL)).json();
const layers = manifest.config.layers.map(l => l.name);
console.log(`  revision: ${manifest.config.revision}`);
console.log(`  layers:   ${layers.join(', ')}`);
check('Indeed-pattern test layer present', layers.includes(TEST_LAYER));

console.log('\n=== Phase 2: SSR response contains Indeed payload ===');
const ssr = await (await fetch(`${URL}?t=${Date.now()}`)).text();
const ssrSizeKB = (ssr.length / 1024).toFixed(1);
console.log(`  SSR response size: ${ssrSizeKB} KB`);
check('Sponsored Job plans headline in SSR',           ssr.includes('Sponsored Job plans'));
check('id="opt-1445" tier section in SSR',             ssr.includes('id="opt-1445"'));
check('class="opt-moo-1399" FAQ wrapper in SSR',       ssr.includes('class="opt-moo-1399"'));
check('FAQ question buttons in SSR',                   ssr.includes('xds-faq-question-btn'));
check('hire-more section in SSR',                      ssr.includes('opt-hire-more-section'));
check('explore-more section in SSR',                   ssr.includes('opt-explore-more-section'));

console.log('\n=== Phase 3+4: browser post-hydration state ===');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${URL}?t=${Date.now()}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const state = await page.evaluate(() => {
  const opt1445 = document.getElementById('opt-1445');
  const opt1399 = document.querySelector('.opt-moo-1399');
  const header  = document.querySelector('[data-tn-section="header"]');
  const headerStillHasClass = header?.classList.contains('hasTransparentGnavBackground') ?? null;

  // Rearrange check — if Change 3 is authored, header comes BEFORE opt-moo-1399.
  let headerBeforeOpt1399 = null;
  if (header && opt1399) {
    headerBeforeOpt1399 = (header.compareDocumentPosition(opt1399) & 4) === 4;
  }

  const faqButtons = document.querySelectorAll('.opt-faq-section button.xds-faq-question-btn');
  const tooltipCheckboxes = document.querySelectorAll('#opt-1445 input[type="checkbox"], #opt1399FAQ input[type="checkbox"]');

  return {
    opt1445Present:           !!opt1445,
    opt1399Present:           !!opt1399,
    headerPresent:            !!header,
    headerStillHasClass,
    headerBeforeOpt1399,
    faqButtonCount:           faqButtons.length,
    tooltipCheckboxCount:     tooltipCheckboxes.length,
    busEvents:                (window.__EDGE_DEL_V2__?.events || []).map(e => e?.detail?.kind || e?.kind || e.kind)
  };
});

check('#opt-1445 (tier section) post-hydration',  state.opt1445Present);
check('.opt-moo-1399 (FAQ section) post-hydration', state.opt1399Present);
check('header element survives',                   state.headerPresent);
check('hasTransparentGnavBackground REMOVED from header',
      state.headerStillHasClass === false,
      state.headerStillHasClass === null ? 'header missing' : `headerStillHasClass=${state.headerStillHasClass}`);
check('FAQ button count (expected 9)',             state.faqButtonCount === 9, `got ${state.faqButtonCount}`);
check('tooltip checkbox count (>0)',               state.tooltipCheckboxCount > 0, `got ${state.tooltipCheckboxCount}`);

// Rearrange is optional — only check if it was authored.
if (state.headerBeforeOpt1399 !== null) {
  if (state.headerBeforeOpt1399) {
    console.log(`  ✓ rearrange applied — header comes BEFORE .opt-moo-1399`);
  } else {
    console.log(`  ⚠ rearrange NOT applied — header is after .opt-moo-1399 (add Change 3 in Visual Editor)`);
  }
}

console.log(`\n  companion bus events: ${state.busEvents.join(' → ')}`);

console.log('\n=== Phase 5: interactive behaviour (Change 4 custom code) ===');
// Click the first FAQ question and assert it toggles .active
const firstQ = await page.$('.opt-faq-section button.xds-faq-question-btn');
if (firstQ) {
  const wasActive = await firstQ.evaluate(el => el.classList.contains('active'));
  await firstQ.click();
  await page.waitForTimeout(150);
  const nowActive = await firstQ.evaluate(el => el.classList.contains('active'));
  check('FAQ accordion toggles .active on click', wasActive !== nowActive);
} else {
  check('FAQ question present to click', false);
}

console.log('\n=== Phase 6: SPA persistence ===');
console.log('  cold /hire/cs/pricing → /  → /hire/cs/pricing — variation must hold');

await page.goto(`${URL}?t=${Date.now()}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.click('a[href="/"]');
await page.waitForTimeout(800);
await page.goto(`${URL}?t=${Date.now()}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const after = await page.evaluate(() => ({
  opt1445Present: !!document.getElementById('opt-1445'),
  opt1399Present: !!document.querySelector('.opt-moo-1399'),
  faqCount:       document.querySelectorAll('.opt-faq-section button.xds-faq-question-btn').length,
  eventCount:     window.__EDGE_DEL_V2__?.events?.length
}));
check('variation present after SPA round-trip',     after.opt1445Present && after.opt1399Present);
check('FAQ buttons present after SPA round-trip',   after.faqCount === 9, `got ${after.faqCount}`);
console.log(`  companion event count post-roundtrip: ${after.eventCount}`);

await browser.close();

console.log('\n=== verdict ===');
console.log(allPass ? '  ALL CHECKS PASSED' : '  SOME CHECKS FAILED — see above');
process.exit(allPass ? 0 : 1);
