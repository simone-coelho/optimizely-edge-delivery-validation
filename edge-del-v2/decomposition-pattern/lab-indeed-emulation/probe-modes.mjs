// Probe DOM state in all three training modes.
import { chromium } from 'playwright';

const URL = 'https://edge-del-v2-target.pages.dev/hire/cs/pricing';

const modes = [
  { name: 'control',                    qs: '?variation=off' },
  { name: 'variation, no reinforce',    qs: '?reinforce=off' },
  { name: 'variation + reinforce',      qs: '' }
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();

for (const m of modes) {
  console.log(`\n=== ${m.name.toUpperCase()} ===`);
  console.log(`URL: ${URL}${m.qs}`);
  const p = await ctx.newPage();
  const warns = [];
  p.on('console', x => { const t = x.text(); if (t.toLowerCase().includes('hydration') || t.toLowerCase().includes('mismatch')) warns.push(t.slice(0, 200)); });
  await p.goto(`${URL}${m.qs}${m.qs.includes('?') ? '&' : '?'}t=${Date.now()}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);

  const state = await p.evaluate(() => ({
    opt1445:       !!document.getElementById('opt-1445'),
    opt1399:       !!document.querySelector('.opt-moo-1399'),
    placeholder:   !!document.querySelector('[data-tn-section="main"]'),
    header:        !!document.querySelector('[data-tn-section="header"]'),
    faqButtons:    document.querySelectorAll('button.xds-faq-question-btn').length,
    mainExists:    !!document.querySelector('main'),
    mainChildCount: document.querySelector('main')?.children.length || 0,
    bus:           (window.__EDGE_DEL_V2__?.events || []).map(e => e?.detail?.kind || e?.kind)
  }));
  console.log(JSON.stringify(state, null, 2));
  if (warns.length) console.log('  Hydration warnings:', warns.slice(0, 2));
  await p.close();
}

await browser.close();
