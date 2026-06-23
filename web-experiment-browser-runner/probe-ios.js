/**
 * iOS / Consent-Engine PROBE
 * ═══════════════════════════
 * Investigates the customer's theory: a consent management platform (CMP) gates
 * the Optimizely snippet on iOS so it never (re)activates, so events aren't
 * dispatched — and removing the CMP / activating organically fixes it.
 *
 * It loads the experiment URL as an iPhone and reports: which consent engine is
 * present, whether the Optimizely snippet ran, whether the decision/conversion
 * events dispatched, and — critically for a redirect test — whether the decision
 * dispatched BEFORE the redirect navigated away (the iOS drop window).
 *
 * Engines:
 *   --engine=webkit   (DEFAULT) real Safari/WebKit engine. Best iOS fidelity.
 *                     Needs WebKit deps — runs out-of-the-box on macOS; on Linux
 *                     run `sudo npx playwright install-deps webkit` first.
 *   --engine=chromium tests the CONSENT/JS layer only (Blink engine). Does NOT
 *                     reproduce iOS WebKit (ITP, beacon-on-navigation). Handy
 *                     where WebKit can't run.
 *
 * CMP modes (isolate the consent engine's effect):
 *   --mode=observe    (DEFAULT) load normally, change nothing — baseline.
 *   --mode=accept     auto-click the consent "Accept" button → does the snippet
 *                     (re)activate + dispatch after consent?
 *   --mode=block      abort known CMP network requests → simulates "CMP removed"
 *                     → does Optimizely activate organically + dispatch?
 *
 *   node probe-ios.js                                   # webkit, observe
 *   node probe-ios.js --engine=chromium --mode=observe  # runs anywhere
 *   node probe-ios.js --engine=webkit --mode=block      # the "fix" hypothesis
 *   node probe-ios.js --engine=webkit --mode=accept --device="iPhone 14 Pro"
 */
'use strict';

const fs = require('fs');
const path = require('path');
const playwright = require('playwright');
const { c } = require('./lib/util');

const CMP_RX = /onetrust|cookielaw|cookiebot|cybot|trustarc|truste|osano|usercentrics|cookiepro|quantcast|sourcepoint|consent|didomi|termly/i;

(async function main() {
  const argv = process.argv.slice(2);
  const headed = argv.includes('--headed');
  const opt = (name, def) => { const a = argv.find(x => x.startsWith('--' + name + '=')); return a ? a.split('=').slice(1).join('=') : def; };
  const engine = opt('engine', 'webkit');
  const deviceName = opt('device', 'iPhone 13');
  const mode = opt('mode', 'observe');
  const cfgPath = path.resolve(argv.find(a => !a.startsWith('--')) || 'config/nasm-redirect.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const settleMs = (cfg.timing && cfg.timing.settleMs) || 6000;
  const navTimeout = (cfg.timing && cfg.timing.navTimeoutMs) || 45000;

  const browserType = playwright[engine];
  if (!browserType) { console.error(c.red('Unknown engine: ' + engine)); process.exit(1); }
  const device = playwright.devices[deviceName] || playwright.devices['iPhone 12'] || {};

  console.log('\n' + c.bold('  Optimizely iOS / Consent-Engine PROBE'));
  console.log(c.gray('  engine : ') + engine + '   ' + c.gray('device: ') + deviceName + '   ' + c.gray('CMP mode: ') + mode);
  console.log(c.gray('  url    : ') + cfg.startUrl);
  if (engine !== 'webkit') {
    console.log(c.yellow('  NOTE: engine=' + engine + ' tests the CONSENT/JS layer only — it does NOT reproduce the iOS'));
    console.log(c.yellow('        WebKit engine (ITP, beacon-on-navigation). Use --engine=webkit on a Mac for fidelity.'));
  }
  console.log('');

  let browser;
  try {
    browser = await browserType.launch({ headless: !headed });
  } catch (e) {
    console.log(c.red('  ✗ Could not launch ' + engine + ': ' + e.message.split('\n')[0]));
    if (engine === 'webkit') console.log(c.gray('    WebKit needs system libs. macOS: works out of the box. Linux/WSL: sudo npx playwright install-deps webkit'));
    process.exit(1);
  }
  const ctx = await browser.newContext(Object.assign({}, device));
  const page = await ctx.newPage();

  if (mode === 'block') {
    await page.route('**/*', route => (CMP_RX.test(route.request().url()) ? route.abort() : route.continue()));
  }

  // Capture event dispatch + timing relative to the redirect.
  const t0 = Date.now();
  let redirectAt = null;
  const events = [];
  page.on('request', req => {
    const u = req.url();
    if (u.includes('logx.optimizely.com') || u.includes('/v1/events')) {
      let body = ''; try { body = req.postData() || ''; } catch (e) {}
      events.push({ ms: Date.now() - t0, decision: /campaign_activated/.test(body), conversion: /landing_page_rev_gen/.test(body), afterRedirect: redirectAt != null, bytes: body.length });
    }
  });
  page.on('framenavigated', f => { if (f === page.mainFrame() && /rev-b|rev-c/.test(f.url()) && redirectAt == null) redirectAt = Date.now() - t0; });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });

  const step = (n, s) => console.log(c.cyan('  ' + n + ' ') + s);

  try {
    step('1', 'Loading as ' + deviceName + ' (' + engine + ')…');
    try { await page.goto(cfg.startUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout }); }
    catch (e) { console.log(c.gray('     (navigation interrupted: ' + e.message.split('\n')[0] + ')')); }
    await page.waitForLoadState('load', { timeout: navTimeout }).catch(() => {});

    const cmp = await page.evaluate(() => {
      const has = g => { try { return !!window[g]; } catch (e) { return false; } };
      const q = s => !!document.querySelector(s);
      const sig = {
        OneTrust: has('OneTrust') || q('#onetrust-banner-sdk,#onetrust-consent-sdk'),
        Cookiebot: has('Cookiebot') || q('#CybotCookiebotDialog'),
        TrustArc: has('truste') || q('#truste-consent-track,#consent_blackbar'),
        Osano: has('Osano') || q('.osano-cm-window'),
        Usercentrics: has('UC_UI') || q('#usercentrics-root'),
        Didomi: has('Didomi') || q('#didomi-host'),
        Termly: q('[data-tid="banner-content"]'),
      };
      return { detected: Object.keys(sig).filter(k => sig[k]), tcf: typeof window.__tcfapi === 'function' };
    });
    step('2', 'Consent engine: ' + (cmp.detected.length ? c.yellow(cmp.detected.join(', ')) : c.gray('none detected')) + (cmp.tcf ? c.gray('  (IAB TCF API present)') : ''));

    if (mode === 'accept') {
      const sels = [
        '#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        '#CybotCookiebotDialogBodyButtonAccept', '.osano-cm-accept-all', '#truste-consent-button',
        '#didomi-notice-agree-button', 'button:has-text("Accept All")', 'button:has-text("Accept all")',
        'button:has-text("Accept")', '[aria-label*="accept" i]',
      ];
      let clicked = null;
      for (const s of sels) { try { const el = await page.waitForSelector(s, { timeout: 2000 }); if (el) { await el.click({ timeout: 1500 }); clicked = s; break; } } catch (e) {} }
      step('3', 'Consent accept: ' + (clicked ? c.green('clicked ' + clicked) : c.red('no accept button matched — pass the selector and I will add it')));
    }

    step('4', 'Settling ' + settleMs + 'ms for bucket + redirect + dispatch…');
    await page.waitForTimeout(settleMs);

    const finalUrl = page.url();
    const snippet = await page.evaluate((expId) => {
      const o = window.optimizely; const out = { present: !!o };
      try {
        if (o && o.get) {
          out.initialized = !!o.initialized;
          const st = o.get('state');
          const vm = st && st.getVariationMap ? st.getVariationMap() : null;
          out.decision = vm && vm[expId] ? { id: String(vm[expId].id) } : null;
          out.redirect = st && st.getRedirectInfo ? st.getRedirectInfo() : null;
        }
      } catch (e) { out.err = String(e && e.message); }
      return out;
    }, cfg.experimentId).catch(e => ({ evalError: e.message }));

    let variation = null;
    for (const v of cfg.variations) { if (v.urlContains && finalUrl.includes(v.urlContains)) { variation = v.name; break; } }

    step('5', 'Final URL: ' + finalUrl);
    step('6', 'Variation: ' + (variation ? c.green(variation) : c.red('UNKNOWN')) +
      '   Snippet: present ' + (snippet.present ? c.green('yes') : c.red('NO')) + '  initialized ' + (snippet.initialized ? c.green('yes') : c.red('no')));

    const decisions = events.filter(e => e.decision);
    const convs = events.filter(e => e.conversion);
    step('7', 'logx requests: ' + events.length + '   decision-bearing: ' + (decisions.length ? c.green(String(decisions.length)) : c.red('0')) + '   conversion-bearing: ' + (convs.length ? c.green(String(convs.length)) : c.red('0')));
    step('8', 'Redirect fired: ' + (redirectAt != null ? c.cyan(redirectAt + 'ms') : c.gray('no redirect (control or none)')));
    if (redirectAt != null && decisions.length) {
      const before = decisions.filter(d => d.ms <= redirectAt).length;
      step('9', 'Decisions dispatched BEFORE the redirect: ' + (before > 0
        ? c.green(before + '/' + decisions.length + '  ✓ would survive on iOS')
        : c.red('0/' + decisions.length + '  — only AFTER redirect; real iOS may drop these')));
    }
    if (consoleErrors.length) console.log(c.gray('     console errors (' + consoleErrors.length + '): ' + consoleErrors.slice(0, 3).join(' | ')));

    const shot = path.join(path.dirname(cfgPath), '..', 'runs', 'probe-ios-' + engine + '-' + mode + '-' + Date.now() + '.png');
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: shot }).catch(() => {});
    step('10', 'Screenshot: ' + shot);

    const dispatched = decisions.length > 0;
    console.log('');
    console.log(c.bold((snippet.present && dispatched ? c.green('  ✓ ') : c.red('  ✗ ')) +
      'engine=' + engine + ' mode=' + mode + ': snippet ' + (snippet.present ? 'ran' : 'BLOCKED') +
      ', decision ' + (dispatched ? 'DISPATCHED' : 'NOT dispatched') + (variation ? ', bucketed ' + variation : '')));
    console.log('');
  } catch (e) {
    console.log(c.red('\n  probe error: ' + (e && e.stack ? e.stack : e)) + '\n');
  } finally {
    await browser.close();
  }
})();
