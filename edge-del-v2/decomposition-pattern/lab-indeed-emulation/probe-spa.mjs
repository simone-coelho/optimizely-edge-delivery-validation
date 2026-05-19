// Genuine SPA-navigation test: click a NuxtLink, wait for the router
// to settle, then click back to /hire/cs/pricing. With reinforce=off
// the second visit goes through Nuxt's client-side router (no edge
// processing → no edge variation), so the variation must be gone.
import { chromium } from 'playwright';

const BASE = 'https://edge-del-v2-target.pages.dev';

const modes = [
  { name: 'no reinforce', qs: '?reinforce=off' },
  { name: 'reinforce on', qs: '' }
];

const b = await chromium.launch({ headless: true });

for (const m of modes) {
  console.log(`\n=== mode: ${m.name} ===`);
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  p.on('console', msg => { const t = msg.text(); if (t.includes('Hydration')) console.log('  [warn]', t.slice(0, 120)); });

  // 1. Cold-load /hire/cs/pricing
  await p.goto(`${BASE}/hire/cs/pricing${m.qs}${m.qs.includes('?') ? '&' : '?'}t=${Date.now()}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const initial = await p.evaluate(() => ({
    opt1445: !!document.getElementById('opt-1445'),
    opt1399: !!document.querySelector('.opt-moo-1399'),
    fAQ: document.querySelectorAll('button.xds-faq-question-btn').length
  }));
  console.log('  cold visit:', JSON.stringify(initial));

  // 2. SPA navigate to /  (NuxtLink, no full reload)
  await p.click('a[href="/"]');
  await p.waitForTimeout(1500);
  const onHome = await p.evaluate(() => ({ url: location.pathname, optEl: !!document.getElementById('opt-1445') }));
  console.log('  on /:', JSON.stringify(onHome));

  // 3. SPA navigate back to /hire/cs/pricing via the URL bar — but
  //    using router.push, NOT a full reload. We'll script it from JS
  //    since the lab's nav doesn't link to /hire/cs/pricing.
  await p.evaluate(() => {
    const nuxt = window.$nuxt || window.useNuxtApp?.() || {};
    const router = nuxt.$router || window.useRouter?.();
    if (router?.push) {
      router.push('/hire/cs/pricing');
    } else {
      history.pushState({}, '', '/hire/cs/pricing');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  });
  await p.waitForTimeout(2000);

  const afterSpa = await p.evaluate(() => ({
    url: location.pathname,
    opt1445: !!document.getElementById('opt-1445'),
    opt1399: !!document.querySelector('.opt-moo-1399'),
    fAQ: document.querySelectorAll('button.xds-faq-question-btn').length,
    placeholder: !!document.querySelector('[data-tn-section="main"]')
  }));
  console.log('  SPA back to /hire/cs/pricing:', JSON.stringify(afterSpa));
  await ctx.close();
}

await b.close();
