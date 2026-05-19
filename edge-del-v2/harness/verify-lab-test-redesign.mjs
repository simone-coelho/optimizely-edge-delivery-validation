// Validation runner for the decomposition-pattern lab test.
//
// Hits https://edge-del-v2-target.pages.dev/pricing in both reinforce
// modes, captures pre-hydration HTML AND post-hydration DOM state, and
// reports the outcome of each of the four changes from the test
// experiment authored against the Optimizely project 5953372780494848.
//
// Run when:
//   The /pricing experiment is published and started in Optimizely UI.
//   Confirmed by manifest revision > 8 and a second layer in
//   https://cdn.optimizely.com/js/web_sdk_v0_5953372780494848.json.
//
// Usage:
//   cd harness && npx tsx verify-lab-test-redesign.mjs

import { chromium } from 'playwright';

const URL = 'https://edge-del-v2-target.pages.dev/pricing';
const MANIFEST_URL = 'https://cdn.optimizely.com/js/web_sdk_v0_5953372780494848.json';

const browser = await chromium.launch({ headless: true });

// ── Pre-flight: confirm the experiment is in the manifest ──────────────
const manifestRes = await fetch(MANIFEST_URL, { headers: { 'cache-control': 'no-cache' } });
const manifest = await manifestRes.json();
const cfg = manifest.config;
const pricingLayer = cfg.layers.find(l =>
  l.viewIds?.some(vid => {
    const v = cfg.views.find(vv => vv.id === vid);
    return JSON.stringify(v?.staticConditions || []).includes('/pricing');
  })
);

console.log('=== manifest pre-flight ===');
console.log('revision:                ', cfg.revision);
console.log('layers (total):          ', cfg.layers.length);
console.log('pricing-targeting layer: ', pricingLayer ? `"${pricingLayer.name}" (id ${pricingLayer.id})` : 'NOT FOUND');

if (!pricingLayer) {
  console.error('');
  console.error('The /pricing experiment is not yet in the manifest.');
  console.error('Author and start it in Optimizely UI first, then re-run.');
  process.exit(2);
}

const expt = pricingLayer.experiments[0];
const variation = expt.variations.find(v => v.name !== 'Original' && v.actions?.length);
console.log('experiment:              ', `"${expt.name}" (id ${expt.id})`);
console.log('variation under test:    ', `"${variation?.name}" (id ${variation?.id})`);
console.log('change count:            ', variation?.actions?.[0]?.changes?.length);
console.log('change types in variation:', variation?.actions?.[0]?.changes?.map(c => c.type).join(', '));
console.log('');

// ── Run /pricing in both reinforce modes ───────────────────────────────
async function inspect(variant) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  let preHydrationHtml = null;
  page.on('response', async (resp) => {
    if (resp.url() === URL || resp.url().split('?')[0] === URL.split('?')[0]) {
      try { preHydrationHtml = await resp.text(); } catch {}
    }
  });

  const pageUrl = `${URL}?reinforce=${variant}&t=${Date.now()}`;
  await page.goto(pageUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => {
    const lab = document.getElementById('lab-redesign');
    const h1 = document.getElementById('pricing-page-title');
    const lead = document.getElementById('pricing-page-lead');
    const pricing = document.querySelector('[data-edge-region="pricing-cards"]');
    const pageRoot = document.querySelector('.page-pricing') || document.querySelector('main');
    const order = Array.from(pageRoot?.children || []).map(c =>
      c.id ||
      c.getAttribute('data-edge-region') ||
      c.getAttribute('data-edge-anchor') ||
      c.tagName.toLowerCase()
    );
    return {
      labBlock: !!lab,
      labCompanionInserted: lab?.parentElement?.querySelector('[data-edge-companion-inserted="1"]') ? true : false,
      h1HasOptlyClass: h1?.classList.contains('optly-redesign'),
      h1Classes: h1 ? Array.from(h1.classList) : null,
      leadAfterPricing: order.indexOf('pricing-page-lead') > order.indexOf('pricing-cards'),
      pageChildOrder: order,
      faqWired: document.querySelectorAll('#lab-redesign .lab-faq-question.lab-wired-up').length,
      faqTotal: document.querySelectorAll('#lab-redesign .lab-faq-question').length,
      busEvents: (window.__EDGE_DEL_V2__?.events || []).map(e => e?.detail?.kind || e?.kind)
    };
  });

  const ssrHadBanner = preHydrationHtml ? preHydrationHtml.includes('id="lab-redesign"') : null;
  const ssrHadOptlyClass = preHydrationHtml ?
    /<h1[^>]+id="pricing-page-title"[^>]+class=[^>]*optly-redesign/.test(preHydrationHtml) :
    null;
  const ssrLeadBefore = preHydrationHtml?.indexOf('id="pricing-page-lead"') ?? -1;
  const ssrPricingBefore = preHydrationHtml?.indexOf('data-edge-region="pricing-cards"') ?? -1;
  const ssrLeadAfterPricing = ssrLeadBefore > ssrPricingBefore;

  await ctx.close();
  return {
    variant,
    ssr: {
      labBlock: ssrHadBanner,
      h1HasOptlyClass: ssrHadOptlyClass,
      leadAfterPricing: ssrLeadAfterPricing
    },
    postHydration: state
  };
}

const off = await inspect('off');
const on = await inspect('on');
await browser.close();

// ── Report ─────────────────────────────────────────────────────────────
const fmt = (v) => v === true ? '✓' : v === false ? '✗' : '?';

console.log('=== change-by-change outcome ===');
console.log('');
console.log('                            SSR (in bytes)  →  Post-hydration  (with reinforce=off / =on)');
console.log('───────────────────────────────────────────────────────────────────────────────────────────');
console.log(`Change 1 (Insert HTML):     ${fmt(on.ssr.labBlock)}                  ${fmt(off.postHydration.labBlock)}  / ${fmt(on.postHydration.labBlock)}`);
console.log(`Change 2 (class on h1):     ${fmt(on.ssr.h1HasOptlyClass)}                  ${fmt(off.postHydration.h1HasOptlyClass)}  / ${fmt(on.postHydration.h1HasOptlyClass)}`);
console.log(`Change 3 (lead after cards):${fmt(on.ssr.leadAfterPricing)}                  ${fmt(off.postHydration.leadAfterPricing)}  / ${fmt(on.postHydration.leadAfterPricing)}`);
console.log(`Change 4 (FAQ accordion):  ${on.postHydration.faqWired}/${on.postHydration.faqTotal} buttons wired (reinforce=on)`);
console.log('');
console.log('Post-hydration page-pricing child order:');
console.log('  reinforce=off:', off.postHydration.pageChildOrder);
console.log('  reinforce=on: ', on.postHydration.pageChildOrder);
console.log('');
console.log('Companion bus event sequence (reinforce=on):');
console.log('  ' + on.postHydration.busEvents.join(' → '));
