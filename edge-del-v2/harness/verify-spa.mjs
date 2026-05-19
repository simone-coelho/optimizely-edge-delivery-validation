// SPA navigation test for the reinforcement companion.
//
// Flow:
//   1. Land on /pricing — variation must be present (post-hydration / post-companion-apply).
//   2. Click the Home nav link — SPA navigation, no full reload. /pricing-specific variation should NOT be visible.
//   3. Click the Pricing nav link — back to /pricing via SPA navigation. Variation must reapply.
//   4. Repeat one more time to confirm idempotency on revisits.

import { chromium } from 'playwright';

const BASE = 'https://edge-del-v2-target.pages.dev';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
const page = await ctx.newPage();

async function snapshot(label) {
  await page.waitForTimeout(1200); // give companion + framework time to settle
  const url = page.url();
  const s = await page.evaluate(() => {
    const lab = document.getElementById('lab-redesign');
    const h1 = document.getElementById('pricing-page-title');
    const lead = document.getElementById('pricing-page-lead');
    const pricing = document.querySelector('[data-edge-region="pricing-cards"]');
    const cards = document.querySelector('.cards');
    let leadAfterPricing = false;
    if (lead && pricing) {
      leadAfterPricing = (pricing.compareDocumentPosition(lead) & 4) === 4;
    }
    const bus = window.__EDGE_DEL_V2__;
    return {
      url:                window.location.pathname,
      labBlockExists:     !!lab,
      labBlockHasContent: !!lab && lab.textContent.includes('Plans (variant)'),
      h1HasClass:         h1?.classList.contains('optly-redesign') || false,
      leadAfterPricing,
      faqButtonsWired:    document.querySelectorAll('#lab-redesign .lab-faq-question.lab-wired-up').length,
      routeCount:         bus?.routeCount,
      activeRoute:        bus?.activeRoute,
      recentEvents:       (bus?.events || []).slice(-5).map(e => e?.detail?.kind || e?.kind)
    };
  });
  console.log(`\n--- ${label} (${url}) ---`);
  console.log(JSON.stringify(s, null, 2));
  return s;
}

console.log('=== Step 1: cold load /pricing ===');
await page.goto(`${BASE}/pricing?t=${Date.now()}`, { waitUntil: 'networkidle' });
const s1 = await snapshot('After cold load /pricing');

console.log('\n=== Step 2: click "Home" nav link (SPA navigation) ===');
await page.click('a[href="/"]');
const s2 = await snapshot('After SPA navigation to /');

console.log('\n=== Step 3: click "Pricing" nav link (SPA navigation back) ===');
await page.click('a[href="/pricing"]');
const s3 = await snapshot('After SPA navigation back to /pricing');

console.log('\n=== Step 4: navigate away and back again ===');
await page.click('a[href="/features"]');
await page.waitForTimeout(600);
await page.click('a[href="/pricing"]');
const s4 = await snapshot('After /features → /pricing');

console.log('\n=== summary ===');
console.log('Cold load — lab present:        ', s1.labBlockExists, '|', 'h1 class:', s1.h1HasClass, '| lead-after:', s1.leadAfterPricing);
console.log('After nav to / — lab gone:       ', !s2.labBlockExists);
console.log('After return to /pricing #1 —    ', s3.labBlockExists ? 'variation REAPPLIED' : 'BROKEN — variation missing');
console.log('After return to /pricing #2 —    ', s4.labBlockExists ? 'variation REAPPLIED' : 'BROKEN — variation missing');

await browser.close();
