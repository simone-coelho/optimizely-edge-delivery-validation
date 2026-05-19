// Quick probe for /hire/cs/pricing post-hydration state.
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext();
const p = await ctx.newPage();
p.on('console', m => {
  const t = m.text();
  if (t.includes('reinforce') || t.includes('mismatch') || t.includes('Hydration')) console.log('[browser]', t);
});
await p.goto(`https://edge-del-v2-target.pages.dev/hire/cs/pricing?t=${Date.now()}`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);

const state = await p.evaluate(() => {
  const siteMain = document.querySelector('main.site-main');
  return {
    opt1445:        !!document.getElementById('opt-1445'),
    opt1399:        !!document.querySelector('.opt-moo-1399'),
    header:         !!document.querySelector('[data-tn-section="header"]'),
    hireCsPricing:  !!document.querySelector('.hire-cs-pricing'),
    faqButtons:     document.querySelectorAll('button.xds-faq-question-btn').length,
    mainCount:      document.querySelectorAll('main').length,
    mains: Array.from(document.querySelectorAll('main')).map(m => ({
      class: m.className,
      childCount: m.children.length,
      hasDataOptly: Array.from(m.attributes).some(a => a.name.startsWith('data-optly-'))
    })),
    siteMainChildren: Array.from(siteMain?.children || []).slice(0, 10).map(c => ({
      tag: c.tagName, id: c.id || null,
      class: c.className?.toString().slice(0, 50) || null,
      hasAllowMismatch: c.hasAttribute('data-allow-mismatch'),
      hasEdgeApplied: c.hasAttribute('data-edge-applied'),
      hasOptlyMarker: Array.from(c.attributes).some(a => a.name.startsWith('data-optly-'))
    })),
    bus: (window.__EDGE_DEL_V2__?.events || []).map(e => e?.detail?.kind || e?.kind)
  };
});
console.log(JSON.stringify(state, null, 2));
await b.close();
