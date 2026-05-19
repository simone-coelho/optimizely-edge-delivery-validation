// Validation harness for decomposition-pattern/lab-test-redesign.
//
// Runs phases 1-4 from decomposition-pattern/lab-test-redesign/README.md
// against the deployed lab. Expects the Optimizely experiment "Lab —
// Decomposition pattern test" to be authored, published, and running
// against `https://edge-del-v2-target.pages.dev/pricing`.
//
// Usage:
//   cd harness && npx tsx verify-lab-test.mjs
//
// Output prints the four-phase report; exit 0 if reinforce=on shows the
// expected post-hydration state, exit 1 otherwise.

import { chromium } from 'playwright';

const URL = 'https://edge-del-v2-target.pages.dev/pricing';
const MANIFEST_URL = 'https://cdn.optimizely.com/js/web_sdk_v0_5953372780494848.json';

// ── Phase 1: manifest reflects the new experiment ──────────────────────
console.log('=== Phase 1a: Optimizely manifest state ===');
const manifest = await (await fetch(MANIFEST_URL)).json();
const cfg = manifest.config;
console.log('  revision:', cfg.revision);
console.log('  layers:', cfg.layers.length);
let labTestLayer = null;
for (const layer of cfg.layers) {
  console.log(`    - ${layer.name} (${layer.id})`);
  for (const exp of layer.experiments) {
    const changes = exp.variations.flatMap(v => v.actions || []).flatMap(a => a.changes || []);
    console.log(`      experiment: ${exp.name} — ${changes.length} change(s) total across variations`);
    if (/decomposition|lab.*test|four.change/i.test(exp.name)) {
      labTestLayer = layer;
    }
  }
}
if (!labTestLayer) {
  console.log('\n  ❌ The decomposition-pattern test experiment is not yet in the manifest.');
  console.log('     Author + publish "Lab — Decomposition pattern test" in Optimizely UI,');
  console.log('     then re-run this script.');
  process.exit(2);
}
console.log('  ✓ test layer present:', labTestLayer.name);

// ── Phase 1b: edge-applied changes in SSR HTML ─────────────────────────
console.log('\n=== Phase 1b: SSR HTML contains all four edge-applied changes ===');
const ssr = await (await fetch(`${URL}?reinforce=on&t=${Date.now()}`)).text();
const ssrChecks = {
  change1_lab_redesign_block:        ssr.includes('id="lab-redesign"'),
  change2_optly_redesign_class:      /id="pricing-page-title"[^>]*class="[^"]*optly-redesign/.test(ssr),
  change3_lead_after_pricing:        ssr.indexOf('id="pricing-page-lead"') > ssr.indexOf('data-edge-region="pricing-cards"'),
  change4_custom_code_signal:        ssr.includes('5953372780494848')   // Optimizely snippet inline
};
for (const [k, v] of Object.entries(ssrChecks)) {
  console.log(`  ${v ? '✓' : '✗'} ${k}: ${v}`);
}

// ── Phase 2 + 3: post-hydration browser state ──────────────────────────
console.log('\n=== Phase 2+3: browser checks (reinforce=on vs off) ===');
const browser = await chromium.launch({ headless: true });
async function inspect(variant) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${URL}?reinforce=${variant}&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => {
    const lab = document.getElementById('lab-redesign');
    const h1 = document.getElementById('pricing-page-title');
    const lead = document.getElementById('pricing-page-lead');
    const pricing = document.querySelector('[data-edge-region="pricing-cards"]');
    // Check leadAfterPricing via direct sibling relationships rather than
    // a specific container's child-order (Vue's hydration may drop the
    // .page-pricing wrapper div if hydration fails catastrophically, but
    // lead + cards + banner are still siblings somewhere — we ask the
    // DOM which one comes first via compareDocumentPosition).
    let leadAfterPricing = false;
    if (lead && pricing) {
      // 4 = DOCUMENT_POSITION_FOLLOWING — pricing follows lead → lead is BEFORE
      // 2 = DOCUMENT_POSITION_PRECEDING  — pricing precedes lead → lead is AFTER
      const pos = pricing.compareDocumentPosition(lead);
      leadAfterPricing = (pos & 4) === 4;
    }
    return {
      labBlock:         !!lab,
      h1HasClass:       h1?.classList.contains('optly-redesign') || false,
      leadAfterPricing,
      leadPrevSibling:  lead?.previousElementSibling?.className || lead?.previousElementSibling?.id || null,
      faqButtonsWired:  document.querySelectorAll('#lab-redesign .lab-faq-question.lab-wired-up').length,
      busEvents:        (window.__EDGE_DEL_V2__?.events || []).map(e => e?.detail?.kind || e?.kind)
    };
  });
  await ctx.close();
  return state;
}
const off = await inspect('off');
const on  = await inspect('on');
await browser.close();

const fmt = (s) => JSON.stringify(s, null, 2);
console.log('reinforce=off:', fmt(off));
console.log('reinforce=on: ', fmt(on));

// ── Phase 4: summary verdict ───────────────────────────────────────────
console.log('\n=== Phase 4: summary ===');
const pass =
  on.labBlock &&
  on.h1HasClass &&
  on.leadAfterPricing &&
  on.faqButtonsWired === 4 &&
  (on.busEvents.includes('reapply:done') || on.busEvents.includes('boot:no-ops'));
console.log(`reinforce=on pass: ${pass}`);
console.log(`reinforce=off rearrange-revert observed: ${!off.leadAfterPricing && on.leadAfterPricing}`);
console.log('   (this is the textbook reinforcement-layer-earned-its-keep signal)');
process.exit(pass ? 0 : 1);
