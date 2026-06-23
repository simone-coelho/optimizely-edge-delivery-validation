'use strict';

/**
 * One organic visit in a fresh browser context (= a brand-new visitor).
 *
 * A clean context has no cookies / storage, so the Optimizely snippet mints a
 * new optimizelyEndUserId and buckets this visitor independently — exactly like
 * a real first-time visitor. For a redirect test the variation is read from the
 * FINAL URL (unambiguous: /rev-b → B, /rev-c → C, else Control) and confirmed
 * against window.optimizely state. logx POSTs are counted to prove the snippet
 * dispatched the decision + conversion events on its own.
 *
 * Returns: { ok, reached, snippetPresent, variation:{id,name}|null, finalUrl,
 *            logxHits, decisionHits, conversionHits, optState, ms, error }
 */
async function runVisit(browser, cfg, opts) {
  opts = opts || {};
  const started = Date.now();
  const navTimeout = (cfg.timing && cfg.timing.navTimeoutMs) || 45000;
  const settleMs = (cfg.timing && cfg.timing.settleMs) || 6000;

  // Optional device emulation (e.g. cfg.device = "iPhone 13"). When set, the
  // device descriptor's UA/viewport/touch override the desktop defaults.
  const devices = require('playwright').devices;
  const deviceName = opts.device !== undefined ? opts.device : cfg.device;
  const device = deviceName ? (devices[deviceName] || {}) : {};
  const context = await browser.newContext(Object.assign({
    userAgent: (cfg.browser && cfg.browser.userAgent) || undefined,
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
  }, device));
  const page = await context.newPage();

  // Count the Optimizely event dispatches this visitor's snippet makes.
  // conversionMatch lets a config name its own conversion event (page-view
  // "landing_page_rev_gen" for the redirect test, "add_to_cart" for CES, etc.).
  const convRx = new RegExp(cfg.conversionMatch || 'landing_page_rev_gen');
  let logxHits = 0, decisionHits = 0, conversionHits = 0;
  page.on('request', req => {
    const u = req.url();
    if (u.includes('logx.optimizely.com') || u.includes('/v1/events')) {
      logxHits++;
      let body = '';
      try { body = req.postData() || ''; } catch (e) { /* beacon bodies may be opaque */ }
      if (/campaign_activated/.test(body)) decisionHits++;
      if (convRx.test(body)) conversionHits++;
    }
  });

  // Optionally drop heavy resources for speed + to be gentler on the origin.
  // Never blocks scripts / xhr / fetch, so the snippet and its events are intact.
  const block = (cfg.browser && cfg.browser.blockResourceTypes) || [];
  if (block.length) {
    await page.route('**/*', route => {
      return block.includes(route.request().resourceType()) ? route.abort() : route.continue();
    });
  }

  const result = {
    ok: false, reached: false, snippetPresent: false, variation: null, finalUrl: null,
    logxHits: 0, decisionHits: 0, conversionHits: 0, optState: null, ms: 0,
  };

  try {
    let gotoError = null;
    try {
      await page.goto(cfg.startUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout });
    } catch (e) {
      // A client-side redirect can interrupt the initial navigation — tolerate it
      // and judge success from the final state below.
      gotoError = e.message;
    }

    // Dismiss a cookie/consent banner if one is configured.
    for (const sel of (cfg.dismissSelectors || [])) {
      try {
        const el = await page.waitForSelector(sel, { timeout: 2000 });
        if (el) await el.click({ timeout: 1000 });
      } catch (e) { /* not present — fine */ }
    }

    await page.waitForLoadState('load', { timeout: navTimeout }).catch(() => {});
    // Let the snippet bucket, fire the redirect (B/C), load the destination, and
    // dispatch its events.
    await page.waitForTimeout(settleMs);

    const finalUrl = page.url();
    result.finalUrl = finalUrl;
    result.reached = /nasm\.org/i.test(finalUrl);

    // Best-effort confirmation from the snippet's own state.
    let optState = null;
    try {
      optState = await page.evaluate((expId) => {
        const o = window.optimizely;
        if (!o || !o.get) return { present: !!o };
        const out = { present: true, initialized: !!o.initialized };
        try {
          const st = o.get('state');
          if (st) {
            const vm = st.getVariationMap ? st.getVariationMap() : null;
            const dec = vm && vm[expId] ? vm[expId] : null;
            out.decision = dec ? { id: String(dec.id), name: dec.name } : null;
            out.redirect = st.getRedirectInfo ? st.getRedirectInfo() : null;
          }
        } catch (e) { out.stateError = String(e && e.message); }
        return out;
      }, cfg.experimentId);
    } catch (e) { optState = { evalError: e.message }; }
    result.optState = optState;
    result.snippetPresent = !!(optState && optState.present);

    // Variation: for an A/A (no redirect) read it from the snippet's reported
    // decision (getVariationMap returns id but a null name, so map id→config
    // name); otherwise prefer the final URL (definitive for a redirect test).
    function nameForId(id) {
      const m = cfg.variations.find(v => String(v.id) === String(id));
      return m ? { id: m.id, name: m.name } : { id: String(id), name: String(id) };
    }
    let variation = null;
    if (cfg.variationByState) {
      if (optState && optState.decision) variation = nameForId(optState.decision.id);
    } else {
      for (const v of cfg.variations) {
        if (v.urlContains && finalUrl.includes(v.urlContains)) { variation = { id: v.id, name: v.name }; break; }
      }
      if (!variation && optState && optState.decision) variation = nameForId(optState.decision.id);
    }
    result.variation = variation;

    // Optional click action (e.g. "Add to Cart") to fire a click-tracked event.
    // The variation was read above while still on the page; the click may then
    // navigate away (the add-to-cart goes to /cart), so we don't wait for it.
    if (cfg.clickSelector && variation) {
      const before = conversionHits;
      try {
        const el = await page.waitForSelector(cfg.clickSelector, { timeout: 6000 });
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await el.click({ timeout: 6000, noWaitAfter: true });
        await page.waitForTimeout(cfg.clickWaitMs || 3500);
        result.clicked = true;
      } catch (e) { result.clickError = e.message; }
      result.conversionFiredAfterClick = conversionHits > before;
    }

    result.logxHits = logxHits;
    result.decisionHits = decisionHits;
    result.conversionHits = conversionHits;

    // A visit "counts" if we reached the site and either the snippet ran or we
    // resolved a variation. A reached-but-no-snippet visit usually means a bot
    // wall/challenge served instead of the page.
    result.ok = result.reached && (result.snippetPresent || !!variation);
    if (!result.ok) {
      result.error = gotoError ||
        ('no snippet/variation (reached=' + result.reached + ', snippet=' + result.snippetPresent + ', url=' + finalUrl + ')');
    }
  } catch (e) {
    result.error = e.message;
  } finally {
    result.ms = Date.now() - started;
    await context.close().catch(() => {});
  }
  return result;
}

module.exports = { runVisit };
