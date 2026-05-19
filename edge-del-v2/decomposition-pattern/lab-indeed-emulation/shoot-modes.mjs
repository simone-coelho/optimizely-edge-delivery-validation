// Capture screenshots that demonstrate the three training modes.
//
// For each mode we capture two screenshots:
//   * cold-load           — direct GET, edge-applied state, before SPA navigation
//   * after-spa-roundtrip — load → SPA navigate away → SPA navigate back
//
// The training difference between reinforce=off and reinforce=on shows
// up in the "after-spa-roundtrip" pair, not the cold-load pair: Vue's
// hydration tolerates the variation on initial load even without the
// companion (Vue keeps the SSR DOM mostly intact when the page has a
// single <main>). What it cannot do is replay the variation when the
// router mounts a fresh copy of the page during a client-side route
// change. That is the companion's job.
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://edge-del-v2-target.pages.dev';

const MODES = [
  { name: '1-control',                       qs: '?variation=off',   desc: 'control — no edge variation, just the Nuxt placeholder' },
  { name: '2-variation-only-no-reinforce',   qs: '?reinforce=off',   desc: 'variation at edge, companion off' },
  { name: '3-variation-plus-reinforce',      qs: '',                 desc: 'variation at edge + companion (production target)' }
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

for (const m of MODES) {
  const url = `${BASE}/hire/cs/pricing${m.qs}${m.qs.includes('?') ? '&' : '?'}t=${Date.now()}`;
  console.log(`\n${m.name} — ${m.desc}`);
  console.log(`  URL: ${url}`);

  const p = await ctx.newPage();

  // (1) cold-load screenshot
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  const coldPath = resolve(here, `screenshot-${m.name}-cold.png`);
  await p.screenshot({ path: coldPath, fullPage: true });
  console.log(`  cold-load → ${coldPath.split('/').pop()}`);

  // (2) SPA navigate to / then SPA navigate back via the router
  await p.click('a[href="/"]');
  await p.waitForTimeout(1200);
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
  await p.waitForTimeout(2500);
  const spaPath = resolve(here, `screenshot-${m.name}-after-spa-roundtrip.png`);
  await p.screenshot({ path: spaPath, fullPage: true });
  console.log(`  after SPA round-trip → ${spaPath.split('/').pop()}`);

  await p.close();
}

await browser.close();
console.log('\ndone.');
