import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const URL = 'https://edge-del-v2-target.pages.dev/pricing';
const browser = await chromium.launch({ headless: true });

for (const variant of ['on', 'off']) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1800 }
  });
  const page = await ctx.newPage();
  await page.goto(`${URL}?reinforce=${variant}&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Screenshot
  await page.screenshot({ path: `/tmp/pricing-${variant}.png`, fullPage: true });

  // Full inner HTML of <body> for inspection
  const bodyHtml = await page.evaluate(() => document.body.outerHTML);
  writeFileSync(`/tmp/pricing-${variant}-final.html`, bodyHtml);

  // High-level structural state
  const report = await page.evaluate(() => {
    const body = document.body;
    const main = document.querySelector('main');
    const labRedesign = document.getElementById('lab-redesign');
    const h1 = document.getElementById('pricing-page-title');
    const lead = document.getElementById('pricing-page-lead');
    const cards = document.querySelector('[data-edge-region="pricing-cards"]');
    const planCards = document.querySelectorAll('article.card[data-plan-id]');
    return {
      bodyChildCount:      body.children.length,
      mainChildCount:      main?.children.length,
      mainChildOrder:      main ? Array.from(main.children).map(c => c.id || c.className.split(' ')[0] || c.tagName.toLowerCase()) : null,
      labRedesignVisible:  !!labRedesign && labRedesign.offsetHeight > 0,
      h1Visible:           !!h1 && h1.offsetHeight > 0,
      leadText:            lead?.textContent?.slice(0, 60),
      cardsCount:          planCards.length,
      planNames:           Array.from(planCards).map(c => c.id),
      bodyTextLength:      body.innerText.length,
      bodyTextHead:        body.innerText.slice(0, 200).replace(/\s+/g, ' ')
    };
  });
  console.log(`\n=== reinforce=${variant} ===`);
  console.log(JSON.stringify(report, null, 2));
}

await browser.close();
console.log('\nScreenshots: /tmp/pricing-on.png /tmp/pricing-off.png');
console.log('Final body HTML: /tmp/pricing-on-final.html /tmp/pricing-off-final.html');
