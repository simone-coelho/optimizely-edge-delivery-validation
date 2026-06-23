/**
 * Discovery probe for the CES A/A (no-redirect) experiment.
 * Loads the product page as an iPhone (WebKit), dumps the Optimizely config for
 * the experiment (variation IDs, layer/campaign id, the add-to-cart event), finds
 * the add-to-cart button, clicks it, and confirms the click event dispatches.
 *
 *   node probe-ces.js [--headed]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { webkit, chromium, devices } = require('playwright');
const { c } = require('./lib/util');

const START_URL = 'https://www.nasm.org/products/corrective-exercise-specialization';
const EXPERIMENT_ID = '5856770006974464';

(async function main() {
  const argv = process.argv.slice(2);
  const headed = argv.includes('--headed');
  const engine = argv.includes('--chromium') ? chromium : webkit;
  const device = devices['iPhone 13'];

  console.log('\n' + c.bold('  CES A/A — Discovery Probe (iOS WebKit)'));
  console.log(c.gray('  url        : ') + START_URL);
  console.log(c.gray('  experiment : ') + EXPERIMENT_ID + '\n');

  const browser = await engine.launch({ headless: !headed, args: [] });
  const ctx = await browser.newContext(Object.assign({}, device));
  const page = await ctx.newPage();

  const logx = [];
  page.on('request', req => {
    const u = req.url();
    if (u.includes('logx.optimizely.com') || u.includes('/v1/events')) {
      let body = ''; try { body = req.postData() || ''; } catch (e) {}
      const ev = [];
      try { const j = JSON.parse(body); for (const v of (j.visitors || [])) for (const s of (v.snapshots || [])) for (const e of (s.events || [])) ev.push((e.k || e.key || e.y || e.type) + (e.e || e.entity_id ? ' [' + (e.e || e.entity_id) + ']' : '')); } catch (e) {}
      logx.push({ at: Date.now(), events: ev });
    }
  });

  const step = (n, s) => console.log(c.cyan('  ' + n + ' ') + s);
  try {
    step('1', 'Loading…');
    try { await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch (e) { console.log(c.gray('   (' + e.message.split('\n')[0] + ')')); }
    await page.waitForLoadState('load', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(6000);
    step('2', 'Final URL: ' + page.url());

    const info = await page.evaluate((expId) => {
      const out = {};
      try {
        const o = window.optimizely;
        out.snippetPresent = !!o;
        if (o && o.get) {
          out.initialized = !!o.initialized;
          const data = o.get('data') || {};
          out.accountId = data.accountId;
          const exp = data.experiments && data.experiments[expId];
          if (exp) out.experiment = { id: expId, name: exp.name, layerId: String(exp.layerId), variations: (exp.variations || []).map(v => ({ id: String(v.id), name: v.name, weight: v.weight })) };
          const events = data.events || {};
          out.cartEvents = Object.keys(events).filter(id => /cart|add_to/i.test((events[id].apiName || '') + (events[id].name || ''))).map(id => ({ id: String(id), apiName: events[id].apiName, name: events[id].name, config: events[id].config || null }));
          const st = o.get('state');
          const vm = st && st.getVariationMap ? st.getVariationMap() : null;
          out.thisVisitVariation = vm && vm[expId] ? { id: String(vm[expId].id), name: vm[expId].name } : null;
          out.activeExperiments = st && st.getActiveExperimentIds ? st.getActiveExperimentIds() : null;
        }
      } catch (e) { out.error = String(e && e.message); }
      return out;
    }, EXPERIMENT_ID).catch(e => ({ evalError: e.message }));

    step('3', 'Snippet: ' + (info.snippetPresent ? c.green('present') : c.red('absent')) + '  init ' + (info.initialized ? c.green('yes') : c.red('no')) + (info.accountId ? c.gray('  acct ' + info.accountId) : ''));
    if (info.experiment) {
      console.log('     experiment: ' + info.experiment.name + '  layerId=' + info.experiment.layerId);
      console.log('     variations: ' + JSON.stringify(info.experiment.variations));
    } else console.log(c.red('     experiment ' + EXPERIMENT_ID + ' not found in datafile (not active on this URL/visit?)'));
    console.log('     this visit bucketed: ' + JSON.stringify(info.thisVisitVariation));
    console.log('     cart-related events: ' + JSON.stringify(info.cartEvents));

    // Find add-to-cart button candidates.
    const buttons = await page.evaluate(() => {
      const out = [];
      const els = Array.from(document.querySelectorAll('button, a, input[type=submit], [role=button], [data-action]'));
      for (const el of els) {
        const txt = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
        if (/add to (cart|bag)|add to basket/i.test(txt)) {
          let sel = el.tagName.toLowerCase();
          if (el.id) sel += '#' + el.id;
          else if (el.className && typeof el.className === 'string') sel += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
          out.push({ text: txt.slice(0, 40), selector: sel, visible: !!(el.offsetParent), disabled: !!el.disabled });
        }
      }
      return out.slice(0, 8);
    });
    step('4', 'Add-to-cart candidates found: ' + (buttons.length ? c.green(String(buttons.length)) : c.red('0')));
    buttons.forEach((b, i) => console.log('     [' + (i + 1) + '] "' + b.text + '"  ' + b.selector + '  visible=' + b.visible + ' disabled=' + b.disabled));

    step('5', 'logx before click: ' + logx.length + ' request(s)  ' + logx.map(l => l.events.join(',')).join(' | '));

    // Try clicking the first visible candidate and watch for the conversion event.
    const target = buttons.find(b => b.visible && !b.disabled);
    if (target) {
      const before = logx.length;
      step('6', 'Clicking: ' + target.selector);
      try {
        const el = await page.waitForSelector('text=/add to (cart|bag)/i', { timeout: 5000 });
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await el.click({ timeout: 5000 });
        await page.waitForTimeout(4000);
        const newReqs = logx.slice(before);
        const firedCart = newReqs.some(l => l.events.some(e => /cart|add_to/i.test(e)));
        console.log('     after click: ' + newReqs.length + ' new logx request(s)  ' + newReqs.map(l => l.events.join(',')).join(' | '));
        console.log('     add-to-cart event dispatched: ' + (firedCart ? c.green('YES ✓') : c.yellow('not detected in logx (may be tracked differently)')));
        console.log('     URL after click: ' + page.url());
      } catch (e) { console.log(c.red('     click failed: ' + e.message.split('\n')[0])); }
    } else {
      step('6', c.yellow('No clickable add-to-cart found — may need a product option selected first, or it sits behind a different selector.'));
    }

    const shot = path.join(__dirname, 'runs', 'probe-ces-' + Date.now() + '.png');
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    step('7', 'Screenshot: ' + shot);
  } catch (e) {
    console.log(c.red('\n  probe error: ' + (e && e.stack ? e.stack : e)));
  } finally {
    await browser.close();
  }
})();
