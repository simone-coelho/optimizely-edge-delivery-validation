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
    __EDGE_DEL_V2__?: {
      manifest:    VariationManifest | null;
      ranAt:       number | null;
      events:      Array<{ at: number; kind: string; detail?: unknown }>;
      routeCount:  number;
      activeRoute: string | null;
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


// ── URL-change detection: history API patch + popstate + Nuxt
//    `page:finish` hook. We fire `applyForRoute` after a tick so the
//    framework router has a moment to render the new view.
function armRouteListeners(onRoute: (reason: string) => void): void {
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

  // Nuxt-specific: page:finish fires after the new route's component is
  // mounted. Cleanest signal for Vue/Nuxt apps.
  try {
    const useNuxt = (window as any).useNuxtApp;
    if (typeof useNuxt === 'function') {
      const app = useNuxt();
      if (app?.hook) {
        app.hook('page:finish', () => setTimeout(() => onRoute('nuxt.page:finish'), 0));
        pulse('route:nuxt-hook-armed');
      }
    }
  } catch { /* fall through silently */ }
}


// ── Hydration-end signal: for the FIRST apply only. After that we use
//    route-change events instead.
function whenHydrated(cb: () => void): void {
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
}


// ── Boot — wire up initial apply and route listeners.
function boot(): void {
  pulse('boot:armed', { url: window.location.href });

  // Initial apply (fast path from inline manifest).
  whenHydrated(() => {
    applyInitial();
    // ALSO trigger a snippet-data apply on the initial route, in case
    // the inline manifest is stale or empty (defensive).
    applyForRoute('initial-hydration-followup');
  });

  // Subsequent route changes.
  armRouteListeners((reason) => {
    applyForRoute(reason).catch(err => pulse('route:error', String(err)));
  });
}

boot();
