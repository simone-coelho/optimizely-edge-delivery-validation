import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await b.newContext().then(c => c.newPage());
const warnings = [];
p.on('console', m => warnings.push({ type: m.type(), text: m.text().slice(0, 200) }));
p.on('pageerror', err => warnings.push({ type: 'error', text: err.message.slice(0, 200) }));
await p.goto(`https://edge-del-v2-target.pages.dev/hire/cs/pricing?t=${Date.now()}`, { waitUntil: 'networkidle' });
await p.waitForTimeout(3000);

// Force a Vue re-render?
const result = await p.evaluate(() => {
  return {
    nuxtAppExists: !!window.$nuxt || !!window.__NUXT__,
    nuxtState: window.__NUXT__ ? Object.keys(window.__NUXT__).slice(0, 5) : null,
    siteMainChildOuter: document.querySelector('main.site-main')?.children[0]?.outerHTML?.slice(0, 500),
    pageRoot: document.querySelector('main.site-main')?.firstElementChild?.tagName,
    pageRootChildren: Array.from(document.querySelector('main.site-main')?.firstElementChild?.children || []).map(c => ({
      tag: c.tagName, id: c.id || null, class: c.className?.toString().slice(0,40)
    }))
  };
});
console.log(JSON.stringify(result, null, 2));
console.log('\n=== browser warnings ===');
warnings.slice(0, 20).forEach(w => console.log(`[${w.type}] ${w.text}`));
await b.close();
