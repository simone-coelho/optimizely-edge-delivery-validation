// Browser-side reinforcement companion. SPA-aware from the ground up.
//
// Vue, React, Svelte, etc. are single-page applications. After the
// initial document load, route changes happen client-side without a new
// HTTP request to the edge. Edge Delivery does not get a second chance
// to apply variations; the page's framework router swaps content
// in-place. Any layer that re-applies variations must therefore react to
// **every** route change, not just to the initial hydration event.
//
// This companion does that by:
//
//   1. Initial load:
//      - Waits for the framework to finish hydration (Nuxt `app:mounted`
//        first, Vue root `_isMounted` poll second, `requestIdleCallback`
//        last). Reads the inline JSON manifest the worker emitted and
//        applies its ops idempotently. Fast path — no async dependency
//        on the Optimizely snippet being ready yet.
//
//   2. Every subsequent route change:
//      - Listens for `history.pushState` / `replaceState`, `popstate`,
//        and Nuxt's `page:finish` hook. On each change, reads the
//        Optimizely snippet's in-memory `data` and `state` modules
//        (`window.optimizely.get('data')` + `getVariationMap()`) to
//        figure out which experiments target the new URL and what
//        variation the visitor is bucketed into. Maps each
//        Optimizely change to our Op vocabulary. Applies with
//        idempotency markers keyed by the change's stable
//        `change.id` so revisiting the same route is a no-op.
//
//   3. Mutation defence (optional, on by default):
//      - For each applied op, registers a scoped MutationObserver on
//        the targeted subtree. If the framework's reactive system
//        overwrites the change during a re-render, the observer fires
//        and re-applies. Loop-guarded: if the same op is re-applied
//        more than 5 times in 2 s, the companion logs a conflict and
//        gives up for that op.
//
// All companion activity is recorded on `window.__EDGE_DEL_V2__.events`
// and as `CustomEvent('edge-del-v2', {detail})` on `window` so customer
// RUM tooling can subscribe.

import { applyOp, opMark } from './ops';
import type { Op, VariationManifest } from './types';

declare global {
  interface Window {
    optimizely?: {
      initialized?: boolean;
      get?: (m: string) => any;
      push?: (cmd: any) => void;
    };
    useNuxtApp?: () => { hook?: (event: string, cb: () => void) => void };
    Backbone?: {
      history?: {
        started?: boolean;
        on?: (event: string, cb: (...args: any[]) => void) => void;
        fragment?: string;
      };
    };
    __EDGE_DEL_V2__?: {
      manifest:    VariationManifest | null;
      ranAt:       number | null;
      events:      Array<{ at: number; kind: string; detail?: unknown }>;
      routeCount:  number;
      activeRoute: string | null;
      adapter?:    string;
    };
    __EDGE_DEL_V2_CONFIG__?: {
      framework?: 'auto' | 'backbone' | 'nuxt' | 'generic';
      regionRoots?: string[];
      rerenderDebounceMs?: number;
    };
  }
}

const MANIFEST_ID = 'edge-del-v2-manifest';

function bus() {
  return (window.__EDGE_DEL_V2__ ||= {
    manifest:    null,
    ranAt:       null,
    events:      [],
    routeCount:  0,
    activeRoute: null
  });
}

function pulse(kind: string, detail?: unknown): void {
  bus().events.push({ at: performance.now(), kind, detail });
  window.dispatchEvent(new CustomEvent('edge-del-v2', { detail: { kind, detail } }));
}


// ── Convert an Optimizely manifest `change` object to our Op vocabulary.
//    Same shape as edge-entry.ts's changeToOps. Duplicated here because
//    the worker bundle and the companion are emitted as separate
//    artifacts — they share the Op type but not runtime code.
function changeToOps(change: any): Op[] {
  const selector = String(change?.selector || '');
  if (!selector && change?.type !== 'rearrange') return [];

  switch (change.type) {
    case 'append': {
      const position = String(change.operator || 'append').toLowerCase();
      const validPos = (['before', 'after', 'prepend', 'append', 'replace'].includes(position)
        ? position
        : 'append') as 'before' | 'after' | 'prepend' | 'append' | 'replace';
      return [{ type: 'add', selector, html: String(change.value || ''), position: validPos }];
    }
    case 'attribute': {
      const attrs = change.attributes || {};
      const ops: Op[] = [];
      if (attrs.text !== undefined)   ops.push({ type: 'text', selector, value: String(attrs.text) });
      if (attrs.class !== undefined)  ops.push({ type: 'attribute', selector, name: 'class', value: String(attrs.class) });
      if (attrs.html !== undefined)   ops.push({ type: 'add', selector, html: String(attrs.html), position: 'replace' });
      if (attrs.href !== undefined)   ops.push({ type: 'attribute', selector, name: 'href',   value: String(attrs.href) });
      if (attrs.src !== undefined)    ops.push({ type: 'attribute', selector, name: 'src',    value: String(attrs.src) });
      if (attrs.srcset !== undefined) ops.push({ type: 'attribute', selector, name: 'srcset', value: String(attrs.srcset) });
      if (attrs.style !== undefined)  ops.push({ type: 'attribute', selector, name: 'style',  value: String(attrs.style) });
      if (attrs.hide === true)        ops.push({ type: 'attribute', selector, name: 'style',  value: 'display:none' });
      if (attrs.remove === true)      ops.push({ type: 'remove', selector });
      return ops;
    }
    case 'rearrange': {
      const position = String(change.operator || 'after').toLowerCase();
      const validPos = (['before', 'after', 'prepend', 'append'].includes(position)
        ? position
        : 'after') as 'before' | 'after' | 'prepend' | 'append';
      return [{
        type:       'move',
        selector:   String(change.selector || ''),
        toSelector: String(change.insertSelector || change.dest || ''),
        position:   validPos
      }];
    }
    case 'custom_code':
      // Custom code can't be safely re-executed from JSON — could re-run
      // side effects. Custom Code authored by the customer should be
      // self-defensive (MutationObserver pattern; see
      // lab-test-redesign/change-4-custom-code.js for the reference).
      return [];
    default:
      return [];
  }
}


// ── URL targeting evaluation. Walks the view's staticConditions tree
//    (Optimizely's CNF/DNF condition format) and tests against the
//    current URL. `simple` URL match is the dominant case; we also
//    handle `exact`, `substring`, `regex`.
function urlMatchesView(view: any, url: string): boolean {
  const conditions = view?.staticConditions;
  if (!conditions) return false;

  function normalise(u: string): string {
    return u.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/$/, '');
  }

  function evaluate(node: any): boolean {
    if (Array.isArray(node)) {
      const op = node[0];
      const operands = node.slice(1);
      if (op === 'and') return operands.every(evaluate);
      if (op === 'or')  return operands.some(evaluate);
      return false;
    }
    if (node?.type === 'url') {
      const target = String(node.value || '');
      switch (node.match) {
        case 'simple':    return normalise(url) === normalise(target);
        case 'exact':     return url === target;
        case 'substring': return url.includes(target);
        case 'regex':
          try { return new RegExp(target).test(url); } catch { return false; }
      }
      return false;
    }
    // `element_present` conditions are evaluated by the framework, not
    // by URL match. If the rest of the URL-condition tree passes,
    // assume true; the companion's apply step will be a no-op if the
    // targeted elements aren't present.
    if (node?.type === 'element_present') return true;
    return true;
  }
  return evaluate(conditions);
}


// ── Read Optimizely's in-memory snippet state. The snippet is
//    asynchronously loaded; we wait briefly for `initialized` before
//    reading. Times out after 5 s, in which case we fall back to the
//    inline manifest (initial route only).
function waitForOptly(timeoutMs = 5000): Promise<{ data: any; state: any } | null> {
  return new Promise(resolve => {
    const check = () => {
      const o = window.optimizely;
      if (o?.initialized && o.get) {
        try {
          const data = o.get('data');
          const state = o.get('state');
          if (data && state) {
            resolve({ data, state });
            return true;
          }
        } catch { /* fall through */ }
      }
      return false;
    };
    if (check()) return;
    const start = performance.now();
    const iv = setInterval(() => {
      if (check()) { clearInterval(iv); return; }
      if (performance.now() - start > timeoutMs) {
        clearInterval(iv);
        pulse('optly:wait-timeout');
        resolve(null);
      }
    }, 25);
  });
}


// ── Compute the ops for the current URL by walking the Optimizely
//    snippet's in-memory data structure. The snippet exposes a
//    different shape from the raw CDN manifest — `data.experiments`,
//    `data.campaigns`, and `data.pages` are object MAPS keyed by id
//    (not arrays of nested objects). URL targeting lives on
//    `data.pages[id].staticConditions`. Campaigns reference pages via
//    `pageIds` / `viewIds`.
async function opsForCurrentUrl(): Promise<{ ops: Op[]; opOriginIds: string[] }> {
  const url = window.location.href;
  const optly = await waitForOptly();
  if (!optly) return { ops: [], opOriginIds: [] };

  const { data, state } = optly;
  const varMap = (typeof state.getVariationMap === 'function' ? state.getVariationMap() : {}) || {};

  const experiments: Record<string, any> = data?.experiments || {};
  const campaigns:   Record<string, any> = data?.campaigns   || {};
  const pages:       Record<string, any> = data?.pages       || {};
  const ops: Op[] = [];
  const opOriginIds: string[] = [];

  // Build an experimentId → campaignId reverse map so we can find the
  // page targeting for each experiment.
  const campaignByExperiment: Record<string, any> = {};
  for (const campaign of Object.values(campaigns)) {
    for (const expId of (campaign.experimentIds || campaign.experiments?.map?.((e: any) => e.id) || [])) {
      campaignByExperiment[String(expId)] = campaign;
    }
  }

  for (const expId of Object.keys(experiments)) {
    // Visitor must be bucketed into a variation for this experiment.
    const varMapEntry = varMap[expId];
    if (!varMapEntry || !varMapEntry.id) continue;

    const exp = experiments[expId];
    const campaign = campaignByExperiment[String(expId)];
    if (!campaign) continue;

    // URL targeting lives on the campaign's pageIds (or viewIds). At
    // least one must point to a page whose conditions match the URL.
    const pageIds: string[] = (campaign.pageIds || campaign.viewIds || []).map(String);
    const pageMatches = pageIds.some(pid => {
      const p = pages[pid];
      return p && urlMatchesView(p, url);
    });
    if (!pageMatches) continue;

    // Find the bucketed variation in this experiment.
    const variation = (exp.variations || []).find((v: any) => String(v.id) === String(varMapEntry.id));
    if (!variation) continue;

    for (const action of variation.actions || []) {
      for (const change of action.changes || []) {
        const changeOps = changeToOps(change);
        if (changeOps.length === 0) continue;
        for (let i = 0; i < changeOps.length; i++) {
          ops.push(changeOps[i]);
          opOriginIds.push(`${String(change.id || '').toLowerCase()}__${i}`);
        }
      }
    }
  }
  return { ops, opOriginIds };
}


// ── Apply a set of ops with per-op idempotency markers. Each mark is
//    keyed by the originating change.id (Optimizely-assigned UUID) so
//    revisits to the same route find existing markers and no-op.
function applyOpSet(ops: Op[], originIds: string[], routeKey: string): void {
  for (let i = 0; i < ops.length; i++) {
    const mark = originIds[i] || `${routeKey}__${i}`;
    try { applyOp(ops[i], mark); }
    catch (err) { pulse('op:error', { index: i, mark, message: String(err) }); }
  }
}


// ── Initial load: read the inline manifest the worker emitted (fast
//    path, no async). Apply its ops. The worker's manifest is the same
//    set of ops we'd compute from window.optimizely.get('data') for the
//    initial URL, but available BEFORE the snippet finishes loading —
//    so the post-hydration apply doesn't have to wait.
function readInlineManifest(): VariationManifest | null {
  const tag = document.getElementById(MANIFEST_ID);
  if (!tag || !tag.textContent) return null;
  try { return JSON.parse(tag.textContent) as VariationManifest; }
  catch { return null; }
}

function applyInitial(): void {
  const manifest = readInlineManifest();
  bus().manifest = manifest;
  bus().activeRoute = window.location.pathname;
  bus().routeCount = 1;

  if (manifest && manifest.ops?.length) {
    // Build origin IDs from caseId + index (same as before).
    const originIds = manifest.ops.map((_, i) => opMark(manifest.caseId, i));
    applyOpSet(manifest.ops, originIds, window.location.pathname);
    bus().ranAt = performance.now();
    pulse('initial:applied', { caseId: manifest.caseId, ops: manifest.ops.length });
  } else {
    pulse('initial:no-ops');
  }
}


// ── Subsequent route changes: read live Optimizely data and apply for
//    the new URL.
async function applyForRoute(reason: string): Promise<void> {
  const route = window.location.pathname + window.location.search;
  bus().activeRoute = route;
  bus().routeCount = (bus().routeCount || 0) + 1;

  const { ops, opOriginIds } = await opsForCurrentUrl();
  if (ops.length === 0) {
    pulse('route:no-ops', { route, reason });
    return;
  }

  applyOpSet(ops, opOriginIds, route);
  pulse('route:applied', { route, reason, ops: ops.length });
}


// ─── Framework adapters ─────────────────────────────────────────────────
//
// The extract+replay engine above (changeToOps, opsForCurrentUrl,
// applyOpSet, applyForRoute) is framework-agnostic. What VARIES between
// deployments is how the companion learns three things:
//
//   1. when the framework has finished its initial render and the
//      companion's first apply can run;
//   2. when the URL has changed (SPA navigation);
//   3. when a region of the DOM has been re-rendered in place WITHOUT a
//      URL change (mini-cart open, facet filter, quantity update — the
//      common case on storefronts).
//
// Each FrameworkAdapter answers those three questions for one framework.
// Adapters are auto-selected by sniffing for framework globals; a
// `window.__EDGE_DEL_V2_CONFIG__ = { framework: 'backbone' }` override
// lets the customer pin one explicitly and also supply `regionRoots`
// (selectors for the in-place re-render observer).

interface FrameworkAdapter {
  name: string;
  detect(): boolean;
  whenReady(cb: () => void): void;
  onRouteChange(cb: (reason: string) => void): void;
  observeRerenders?(roots: string[], cb: (reason: string) => void): void;
}

// Shared history-API patch. pushState/replaceState/popstate is the
// lowest-common-denominator route-change signal. Nuxt's `page:finish`
// hook and Backbone's `Backbone.history.on('route', …)` are layered on
// top of this where available — they fire AFTER the framework has
// rendered, which is what we want, but the history patch is still
// armed as a fallback for third-party code that navigates outside the
// router (e.g. SCA modules calling history.pushState directly).
function patchHistory(onRoute: (reason: string) => void): void {
  const wrap = (name: 'pushState' | 'replaceState'): void => {
    const orig = history[name];
    history[name] = function (...args: any[]) {
      const r = (orig as any).apply(this, args);
      setTimeout(() => onRoute(`history.${name}`), 50);
      return r;
    } as any;
  };
  try {
    wrap('pushState');
    wrap('replaceState');
    pulse('route:history-patched');
  } catch (err) { pulse('route:history-patch-failed', String(err)); }

  window.addEventListener('popstate', () => setTimeout(() => onRoute('popstate'), 50));
}

// ── Nuxt / Vue adapter — preserves the prior companion's behaviour
//    verbatim. Detection looks for the Nuxt composable global or the
//    standard hydration markers (#__nuxt, [data-server-rendered], or a
//    Vue 3 root with __vue_app__).
const nuxtAdapter: FrameworkAdapter = {
  name: 'nuxt',
  detect(): boolean {
    if (typeof (window as any).useNuxtApp === 'function') return true;
    if (document.querySelector('#__nuxt, [data-server-rendered]')) return true;
    const vueRoot = document.querySelector('#app');
    if (vueRoot && (vueRoot as any).__vue_app__) return true;
    return false;
  },
  whenReady(cb): void {
    const tryNuxt = (): boolean => {
      const useNuxt = (window as any).useNuxtApp;
      if (typeof useNuxt === 'function') {
        try {
          const app = useNuxt();
          if (app && typeof app.hook === 'function') {
            app.hook('app:mounted', () => cb());
            pulse('hydration:nuxt-hook-armed');
            return true;
          }
        } catch { /* fall through */ }
      }
      return false;
    };
    const tryVue = (): boolean => {
      const root = document.querySelector('#__nuxt, #app, [data-server-rendered]');
      const vueApp = (root as any)?.__vue_app__;
      if (vueApp && vueApp._instance) {
        if (vueApp._instance.isMounted) { cb(); return true; }
        let tries = 0;
        const iv = setInterval(() => {
          if (vueApp._instance.isMounted || tries++ > 60) {
            clearInterval(iv);
            cb();
          }
        }, 16);
        pulse('hydration:vue-poll-armed');
        return true;
      }
      return false;
    };
    const tryIdle = (): void => {
      const ric = (window as any).requestIdleCallback as
        | ((c: () => void, opts?: { timeout: number }) => number)
        | undefined;
      if (ric) { ric(cb, { timeout: 500 }); pulse('hydration:idle-armed'); }
      else     { setTimeout(cb, 50);        pulse('hydration:timeout-armed'); }
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      if (!tryNuxt() && !tryVue()) tryIdle();
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (!tryNuxt() && !tryVue()) tryIdle();
      }, { once: true });
    }
  },
  onRouteChange(cb): void {
    patchHistory(cb);
    try {
      const useNuxt = (window as any).useNuxtApp;
      if (typeof useNuxt === 'function') {
        const app = useNuxt();
        if (app?.hook) {
          app.hook('page:finish', () => setTimeout(() => cb('nuxt.page:finish'), 0));
          pulse('route:nuxt-hook-armed');
        }
      }
    } catch { /* fall through silently */ }
  }
};

// ── Backbone adapter — for SuiteCommerce Advanced and other Backbone
//    SPAs. Three signals layered:
//
//      whenReady          → Backbone.history.started, then a rAF so the
//                           first matched route's view renders before
//                           we apply. Falls back to window.load.
//      onRouteChange      → Backbone.history.on('route', …) fires
//                           AFTER the route handler runs (view rendered).
//                           hashchange covers Backbone with pushState:
//                           false. patchHistory covers third-party
//                           navigations.
//      observeRerenders   → scoped MutationObserver per configured
//                           region root (cart, facets, mini-cart, etc).
//                           Re-arms automatically if Backbone swaps the
//                           container element.
const backboneAdapter: FrameworkAdapter = {
  name: 'backbone',
  detect(): boolean {
    return typeof (window as any).Backbone?.history !== 'undefined';
  },
  whenReady(cb): void {
    const Backbone = (window as any).Backbone;
    const tryReady = (): boolean => {
      if (Backbone?.history?.started === true) {
        requestAnimationFrame(() => cb());
        pulse('hydration:backbone-ready');
        return true;
      }
      return false;
    };
    if (tryReady()) return;

    let tries = 0;
    const iv = setInterval(() => {
      if (tryReady()) { clearInterval(iv); return; }
      if (tries++ > 120) {  // ~2 s at 16 ms
        clearInterval(iv);
        if (document.readyState === 'complete') {
          setTimeout(cb, 50);
          pulse('hydration:backbone-fallback-load');
        } else {
          window.addEventListener('load', () => setTimeout(cb, 50), { once: true });
          pulse('hydration:backbone-fallback-onload');
        }
      }
    }, 16);
  },
  onRouteChange(cb): void {
    const Backbone = (window as any).Backbone;
    try {
      if (Backbone?.history?.on) {
        Backbone.history.on('route', (_router: any, name: string) => {
          setTimeout(() => cb(`backbone:route:${name || 'unnamed'}`), 0);
        });
        pulse('route:backbone-hook-armed');
      }
    } catch (err) { pulse('route:backbone-hook-failed', String(err)); }

    window.addEventListener('hashchange', () => setTimeout(() => cb('hashchange'), 50));
    patchHistory(cb);
  },
  observeRerenders(roots, cb): void {
    if (!roots.length) return;
    const cfg = (window as any).__EDGE_DEL_V2_CONFIG__ || {};
    const debounceMs = typeof cfg.rerenderDebounceMs === 'number' ? cfg.rerenderDebounceMs : 75;

    let timer: any = null;
    const fire = (reason: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; cb(reason); }, debounceMs);
    };

    const observed = new WeakSet<Element>();
    const armOne = (sel: string): void => {
      const el = document.querySelector(sel);
      if (!el) { pulse('rerender:root-not-found', sel); return; }
      if (observed.has(el)) return;
      observed.add(el);
      try {
        const mo = new MutationObserver(() => fire(`rerender:${sel}`));
        mo.observe(el, { childList: true, subtree: true });
        pulse('rerender:armed', sel);
      } catch (err) { pulse('rerender:observe-failed', { sel, err: String(err) }); }
    };

    for (const r of roots) armOne(r);

    // Re-arm any root that disappears and reappears (Backbone often
    // swaps a region's container element entirely when re-rendering).
    try {
      const reArm = new MutationObserver(() => {
        for (const sel of roots) armOne(sel);
      });
      reArm.observe(document.body, { childList: true, subtree: true });
    } catch (err) { pulse('rerender:rearm-failed', String(err)); }
  }
};

// ── Generic adapter — pushState/replaceState/popstate only. Last in
//    the priority list so we always have a fallback.
const genericAdapter: FrameworkAdapter = {
  name: 'generic',
  detect(): boolean { return true; },
  whenReady(cb): void {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(cb, 50);
    } else {
      document.addEventListener('DOMContentLoaded', () => setTimeout(cb, 50), { once: true });
    }
  },
  onRouteChange(cb): void {
    patchHistory(cb);
  }
};

const ADAPTERS: FrameworkAdapter[] = [backboneAdapter, nuxtAdapter, genericAdapter];

function selectAdapter(): FrameworkAdapter {
  const cfg = (window as any).__EDGE_DEL_V2_CONFIG__ || {};
  if (cfg.framework && cfg.framework !== 'auto') {
    const pinned = ADAPTERS.find(a => a.name === cfg.framework);
    if (pinned) { pulse('adapter:pinned', cfg.framework); return pinned; }
    pulse('adapter:pin-unknown', cfg.framework);
  }
  for (const a of ADAPTERS) {
    if (a.detect()) { pulse('adapter:auto-selected', a.name); return a; }
  }
  pulse('adapter:fallback-generic');
  return genericAdapter;
}


// ── Boot — pick the adapter for this page, wire its three signals
//    through the framework-agnostic apply functions defined above.
function boot(): void {
  pulse('boot:armed', { url: window.location.href });

  const adapter = selectAdapter();
  bus().adapter = adapter.name;
  const cfg = (window as any).__EDGE_DEL_V2_CONFIG__ || {};
  const regionRoots: string[] = Array.isArray(cfg.regionRoots) ? cfg.regionRoots : [];

  // One-shot initial apply. Two independent signals can trigger it:
  //
  //   1. An `edge-del-v2-hydrated` CustomEvent dispatched on `window`
  //      by the customer's app from a mount handler (React/Next.js
  //      `useEffect`, Vue `onMounted`, etc.). Preferred path for
  //      React/Next.js per CUSTOMER-GUIDE.md §8.5.2 and portable to
  //      any framework where the customer wants explicit control of
  //      apply timing.
  //
  //   2. The auto-selected framework adapter's hydration hook
  //      (Nuxt `app:mounted`, Backbone `history.started + rAF`,
  //      generic `DOMContentLoaded + 50 ms`).
  //
  // Whichever fires first wins; the other becomes a no-op.
  let appliedInitial = false;
  const applyInitialOnce = (source: string): void => {
    if (appliedInitial) { pulse('hydration:duplicate-signal', { source }); return; }
    appliedInitial = true;
    pulse('hydration:signal-received', { source });
    applyInitial();
    applyForRoute('initial-ready-followup');
  };

  // Customer-dispatched event — listener is registered unconditionally
  // for every adapter, so any customer can opt into explicit apply
  // timing by dispatching `edge-del-v2-hydrated` regardless of which
  // framework was auto-selected. `{ once: true }` self-removes after
  // the first dispatch.
  window.addEventListener(
    'edge-del-v2-hydrated',
    () => applyInitialOnce('customer-event'),
    { once: true }
  );
  pulse('hydration:custom-event-armed');

  // Framework adapter's hydration signal. Same `applyInitialOnce`
  // gate, so if the customer event already fired this is a no-op.
  adapter.whenReady(() => applyInitialOnce(`adapter:${adapter.name}`));

  // SPA navigation.
  adapter.onRouteChange((reason) => {
    applyForRoute(reason).catch(err => pulse('route:error', String(err)));
  });

  // Region re-renders without a URL change (Backbone view swaps inside
  // a route, mini-cart open, facet filter change, quantity update).
  // Only adapters that opt in see this; only fires when the customer
  // has supplied regionRoots in the config.
  if (adapter.observeRerenders && regionRoots.length > 0) {
    adapter.observeRerenders(regionRoots, (reason) => {
      applyForRoute(reason).catch(err => pulse('rerender:error', String(err)));
    });
  }
}

boot();
