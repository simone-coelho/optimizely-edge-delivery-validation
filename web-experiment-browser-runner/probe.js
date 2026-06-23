/**
 * Single-visit PROBE — run this FIRST.
 * Loads the experiment URL in a real browser and reports, step by step, whether
 * the organic approach works against this site: does the page load, does the
 * Optimizely snippet run, does the visitor bucket, does the redirect fire, and
 * do the logx events dispatch — plus a screenshot. This is the feasibility /
 * bot-wall check before committing to a full run.
 *
 *   node probe.js                       # headless, default config
 *   node probe.js --headed              # watch it happen
 *   node probe.js config/nasm-redirect.json --headed
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { c } = require('./lib/util');

(async function main() {
  const argv = process.argv.slice(2);
  const headed = argv.includes('--headed');
  const cfgPath = path.resolve(argv.find(a => !a.startsWith('--')) || 'config/nasm-redirect.json');
  if (!fs.existsSync(cfgPath)) { console.error(c.red('Config not found: ' + cfgPath)); process.exit(1); }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const navTimeout = (cfg.timing && cfg.timing.navTimeoutMs) || 45000;
  const settleMs = (cfg.timing && cfg.timing.settleMs) || 6000;

  console.log('\n' + c.bold('  Optimizely Web — Organic Visit PROBE'));
  console.log(c.gray('  url        : ') + cfg.startUrl);
  console.log(c.gray('  experiment : ') + cfg.experimentId + '   ' + c.gray('mode: ') + (headed ? 'headed' : 'headless') + '\n');

  const browser = await chromium.launch({ headless: !headed, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    userAgent: (cfg.browser && cfg.browser.userAgent) || undefined,
    viewport: { width: 1366, height: 768 }, locale: 'en-US',
  });
  const page = await ctx.newPage();

  const logx = [];
  page.on('request', req => {
    const u = req.url();
    if (u.includes('logx.optimizely.com') || u.includes('/v1/events')) {
      let body = ''; try { body = req.postData() || ''; } catch (e) {}
      const entry = { url: u.split('?')[0], bytes: body.length, decisions: [], events: [] };
      try {
        const j = JSON.parse(body);
        for (const v of (j.visitors || [])) for (const s of (v.snapshots || [])) {
          // Web snippet uses abbreviated keys (c/x/v decisions, e/y/k events);
          // Full Stack Event API uses full names. Support both.
          for (const d of (s.decisions || [])) entry.decisions.push((d.x || d.experiment_id) + '→' + (d.v || d.variation_id));
          for (const e of (s.events || [])) entry.events.push((e.k || e.key || e.y || e.type) + '  [entity ' + (e.e || e.entity_id) + ']');
        }
      } catch (e) { entry.parseError = true; }
      logx.push(entry);
    }
  });

  const step = (n, s) => console.log(c.cyan('  ' + n + ' ') + s);

  try {
    step('1', 'Navigating…');
    let status = '?';
    try {
      const resp = await page.goto(cfg.startUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout });
      status = resp ? resp.status() : '?';
    } catch (e) { console.log(c.gray('     (initial navigation interrupted: ' + e.message + ' — usually the redirect; continuing)')); }
    console.log('     HTTP ' + status);

    await page.waitForLoadState('load', { timeout: navTimeout }).catch(() => {});
    step('2', 'Waiting ' + settleMs + 'ms for the snippet to bucket + redirect…');
    await page.waitForTimeout(settleMs);

    const finalUrl = page.url();
    step('3', 'Final URL: ' + finalUrl);

    const snippet = await page.evaluate((expId) => {
      const o = window.optimizely;
      const out = { present: !!o };
      try {
        if (o && o.get) {
          out.initialized = !!o.initialized;
          const st = o.get('state');
          out.variationMap = st && st.getVariationMap ? st.getVariationMap() : null;
          out.redirectInfo = st && st.getRedirectInfo ? st.getRedirectInfo() : null;
          const data = o.get('data');
          out.hasData = !!data;
          out.accountId = data && data.accountId;
        }
      } catch (e) { out.error = String(e && e.message); }
      return out;
    }, cfg.experimentId).catch(e => ({ evalError: e.message }));

    step('4', 'Snippet present: ' + (snippet.present ? c.green('yes') : c.red('NO')) +
      '   initialized: ' + (snippet.initialized ? c.green('yes') : c.red('no')) +
      (snippet.accountId ? c.gray('   account ' + snippet.accountId) : ''));
    if (snippet.variationMap) console.log('     variationMap: ' + JSON.stringify(snippet.variationMap));
    if (snippet.redirectInfo) console.log('     redirectInfo: ' + JSON.stringify(snippet.redirectInfo));
    if (snippet.error || snippet.evalError) console.log(c.gray('     (state read note: ' + (snippet.error || snippet.evalError) + ')'));

    let variation = null;
    for (const v of cfg.variations) {
      if (v.urlContains && finalUrl.includes(v.urlContains)) { variation = { id: v.id, name: v.name }; break; }
    }
    step('5', 'Variation (by final URL): ' + (variation ? c.green(variation.name + '  ' + variation.id) : c.red('UNKNOWN')));

    step('6', 'logx event requests observed: ' + (logx.length ? c.green(String(logx.length)) : c.red('0')));
    logx.forEach((l, i) => {
      console.log('     [' + (i + 1) + '] ' + l.url + '   ' + l.bytes + ' bytes');
      if (l.decisions.length) console.log('         decisions: ' + l.decisions.join('  ·  '));
      if (l.events.length) console.log('         events:    ' + l.events.join('  ·  '));
    });
    console.log(c.gray('     (our experiment: ' + cfg.experimentId + ' — watch which event key its bucketed visitor sends)'));

    const shot = path.join(path.dirname(cfgPath), '..', 'runs', 'probe-' + Date.now() + '.png');
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: shot }).catch(() => {});
    step('7', 'Screenshot: ' + shot);

    const feasible = snippet.present && variation && logx.length > 0;
    console.log('');
    if (feasible) {
      console.log(c.bold(c.green('  ✓ FEASIBLE — snippet ran, visitor bucketed into ' + variation.name + ', ' + logx.length + ' organic event request(s) fired.')));
      console.log(c.gray('  Scale it up:  node run.js --config ' + path.relative(process.cwd(), cfgPath) + ' --per-variation 1000'));
    } else {
      console.log(c.bold(c.red('  ✗ NOT feasible yet:')));
      if (!snippet.present) console.log(c.red('    • Optimizely snippet absent — page blocked, a consent/bot wall served, or the snippet is not on this URL.'));
      if (!variation) console.log(c.red('    • No variation resolved from the final URL — redirect may not have happened in the settle window.'));
      if (!logx.length) console.log(c.red('    • No logx event requests — the snippet did not dispatch events.'));
      console.log(c.gray('    Try: --headed to watch, raise timing.settleMs, add a dismissSelectors entry for a consent banner, or check WAF/bot protection. The screenshot shows what the browser actually saw.'));
    }
    console.log('');
  } catch (e) {
    console.log(c.red('\n  ✗ Probe failed: ' + (e && e.stack ? e.stack : e)) + '\n');
  } finally {
    await browser.close();
  }
})();
