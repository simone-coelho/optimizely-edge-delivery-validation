// _worker.js entry for the Cloudflare Pages deployment.
//
// Pipeline per request:
//   1. Set globalThis._importMeta_ (Nitro requires).
//   2. Nuxt nitro handler → SSR Response.
//   3. applyExperiments(request, ctx, { control: ssrResponse, ... }) → SDK
//      applies the bucketed variation's changes via HTMLRewriter.
//   4. Buffer the rewritten response body, find every `data-optly-<id>`
//      marker the SDK left, cross-reference with the Edge Delivery
//      manifest (cached on the SAME Cloudflare edge that the SDK just
//      queried, so subrequest cost is ~1 ms cache-hit), build a typed
//      Op[] for the companion to replay post-hydration.
//   5. Inject inline manifest + companion script before </body>.
//   6. Stamp x-edge-del-v2 response header so the harness/customer can
//      confirm the worker actually ran.

(globalThis as any)._importMeta_ = { url: 'file:///_entry.js', env: {} };

import { applyExperiments, Options } from '@optimizely/edge-delivery';
import { COMPANION_SOURCE } from 'edge-del-v2-reinforce/companion-source';

// @ts-ignore — external; resolved at runtime against the chunk file Nuxt's
// nitro build writes alongside this entry.
import { F as nitro } from './chunks/nitro/nitro.mjs';

interface Env {
  SNIPPET_ID?: string;
  LAB_BUILD?: string;
  DEBUG?: string;
}

const MANIFEST_TAG_ID = 'edge-del-v2-manifest';
const COMPANION_TAG_ID = 'edge-del-v2-companion';

// ── Op vocabulary (kept in sync with reinforce/src/types.ts) ───────────
type Op =
  | { type: 'text';      selector: string; value: string }
  | { type: 'attribute'; selector: string; name: string; value: string }
  | { type: 'class';     selector: string; add?: string[]; remove?: string[] }
  | { type: 'add';       selector: string; html: string; position: 'before' | 'after' | 'prepend' | 'append' | 'replace' }
  | { type: 'remove';    selector: string }
  | { type: 'move';      selector: string; toSelector: string; position: 'before' | 'after' | 'prepend' | 'append' };

interface VariationManifest {
  caseId: string;
  appliedAt: 'edge';
  buildId: string;
  ops: Op[];
}

// ── Manifest-based extractor ──────────────────────────────────────────
// The SDK tags every modified element with `data-optly-<changeId>`. We
// find those marker IDs in the response body, fetch the same manifest
// the SDK fetched (cache hit on the local Cloudflare edge), look up each
// change, and convert to an Op. The manifest IS the canonical source of
// truth — the response body would only tell us where things landed, not
// what they were.

// The marker must be followed by `=` to qualify as a real DOM attribute.
// This filters out occurrences inside the inline Optimizely snippet
// payload (where the SDK embeds the manifest's transform data — those
// references appear as `data-optly-<id>>` or `"data-optly-<id>","..."`,
// never `data-optly-<id>=`). Real DOM markers always serialise as
// `data-optly-<id>=""` because the HTMLRewriter emits them as attribute
// pairs.
const MARKER_RE = /data-optly-([a-zA-Z0-9-]+)=/g;

function findMarkerIds(body: string): Set<string> {
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  MARKER_RE.lastIndex = 0;
  while ((m = MARKER_RE.exec(body)) !== null) {
    ids.add(m[1].toLowerCase());
  }
  return ids;
}

function buildChangeMap(cfg: any): { byId: Map<string, any>; allChanges: any[] } {
  const byId = new Map<string, any>();
  const allChanges: any[] = [];
  for (const layer of cfg?.layers || []) {
    for (const exp of layer.experiments || []) {
      for (const v of exp.variations || []) {
        for (const action of v.actions || []) {
          for (const change of action.changes || []) {
            allChanges.push(change);
            if (change.id) byId.set(String(change.id).toLowerCase(), change);
          }
        }
      }
    }
  }
  return { byId, allChanges };
}

function changeToOps(change: any): Op[] {
  // Use the change's original selector (the one the customer authored
  // in the Visual Editor). It's owned by their template, stable through
  // Vue's hydration recovery, and matches the manifest's documented
  // intent. The data-optly-<id> marker is useful as a presence-of-change
  // signal for the worker's marker-scan step in findMarkerIds, but
  // post-hydration Vue may strip those markers entirely if hydration
  // falls back to full client-side render — so the companion uses the
  // original selector as its query target.
  const selector = String(change.selector || '');
  if (!selector) return [];

  switch (change.type) {
    case 'append': {
      const position = (change.operator || 'append').toLowerCase();
      const validPos = ['before', 'after', 'prepend', 'append', 'replace'].includes(position)
        ? (position as 'before' | 'after' | 'prepend' | 'append' | 'replace')
        : 'append';
      return [{ type: 'add', selector, html: change.value || '', position: validPos }];
    }
    case 'attribute': {
      const attrs = change.attributes || {};
      const ops: Op[] = [];
      // The attributes object can have multiple sub-keys; emit one Op per
      // sub-key. Companion applies them in order against the same
      // selector.
      if (attrs.text !== undefined) {
        ops.push({ type: 'text', selector, value: String(attrs.text) });
      }
      if (attrs.class !== undefined) {
        // Optimizely sets the full class string (not deltas), so emit as
        // an attribute write rather than a delta-class op.
        ops.push({ type: 'attribute', selector, name: 'class', value: String(attrs.class) });
      }
      if (attrs.html !== undefined) {
        ops.push({ type: 'add', selector, html: String(attrs.html), position: 'replace' });
      }
      if (attrs.href !== undefined) {
        ops.push({ type: 'attribute', selector, name: 'href', value: String(attrs.href) });
      }
      if (attrs.src !== undefined) {
        ops.push({ type: 'attribute', selector, name: 'src', value: String(attrs.src) });
      }
      if (attrs.srcset !== undefined) {
        ops.push({ type: 'attribute', selector, name: 'srcset', value: String(attrs.srcset) });
      }
      if (attrs.style !== undefined) {
        ops.push({ type: 'attribute', selector, name: 'style', value: String(attrs.style) });
      }
      if (attrs.hide === true) {
        ops.push({ type: 'attribute', selector, name: 'style', value: 'display:none' });
      }
      if (attrs.remove === true) {
        ops.push({ type: 'remove', selector });
      }
      // Empty attributes — scaffolding-only change paired with a
      // rearrange dependency. Returns [].
      return ops;
    }
    case 'rearrange': {
      const position = (change.operator || 'after').toLowerCase();
      const validPos = ['before', 'after', 'prepend', 'append'].includes(position)
        ? (position as 'before' | 'after' | 'prepend' | 'append')
        : 'after';
      return [{
        type: 'move',
        selector,
        toSelector: String(change.insertSelector || change.dest || ''),
        position:   validPos
      }];
    }
    case 'custom_code':
      // Custom code can't safely be replayed from a manifest — arbitrary
      // JS could re-run side effects (analytics, state mutations). The
      // customer's custom code should be defensive on its own (use a
      // MutationObserver to detect DOM re-insertion and re-wire its
      // listeners). See change-4-custom-code.js for the reference pattern.
      return [];
    default:
      return [];
  }
}

async function fetchManifest(snippetId: string): Promise<any | null> {
  const url = `https://cdn.optimizely.com/js/web_sdk_v0_${snippetId}.json`;
  try {
    // Tell CF's edge to honour a short cache TTL so this subrequest hits
    // the same cached manifest the SDK populated.
    const resp = await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } } as any);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (err) {
    console.error('manifest fetch failed', err instanceof Error ? err.message : err);
    return null;
  }
}

async function buildOpsFromManifest(body: string, snippetId: string): Promise<Op[]> {
  const markerIds = findMarkerIds(body);
  if (markerIds.size === 0) return [];
  const manifest = await fetchManifest(snippetId);
  if (!manifest) return [];
  const cfg = manifest.config || manifest;
  const { byId, allChanges } = buildChangeMap(cfg);

  const seenChangeIds = new Set<string>();
  const ops: Op[] = [];

  // Pass 1 — for each marker present in the body, look up its change
  // and emit ops.
  for (const id of markerIds) {
    const change = byId.get(id);
    if (!change) continue;
    seenChangeIds.add(id);
    for (const op of changeToOps(change)) ops.push(op);
  }

  // Pass 2 — rearrange changes don't add their own marker on the
  // source; they declare a dependency on a scaffolding-attribute change
  // that does. If any rearrange's dependency overlaps the markers we
  // found in the body, emit its op too.
  for (const change of allChanges) {
    if (change.type !== 'rearrange') continue;
    const deps = (change.dependencies || []).map((d: any) => String(d).toLowerCase());
    if (!deps.some((d: string) => markerIds.has(d))) continue;
    if (seenChangeIds.has(String(change.id || '').toLowerCase())) continue;
    for (const op of changeToOps(change)) ops.push(op);
  }

  return ops;
}

// ── Worker entry ──────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/__edge-del-v2/health') {
      return new Response(JSON.stringify({
        ok: true,
        mode: 'pages-integrated-sdk',
        snippet: env.SNIPPET_ID || null,
        build: env.LAB_BUILD || null,
        host: url.host
      }), { headers: { 'content-type': 'application/json' } });
    }

    // Training-mode query parameters. These allow engineers to flip
    // between the three states they need to see side-by-side:
    //   `?variation=off`       → control: the raw SSR Nuxt response,
    //                            no edge variation, no companion. The
    //                            page placeholder is what renders.
    //   `?reinforce=off`       → variation runs at the edge but the
    //                            companion is not injected. Vue's
    //                            hydration recovery is free to undo
    //                            the variation. This is the "broken"
    //                            state customers see today.
    //   (no flags)             → variation + companion. The
    //                            production-target state.
    const variation = url.searchParams.get('variation') !== 'off';
    const reinforce = url.searchParams.get('reinforce') !== 'off';
    const labBuild = env.LAB_BUILD || 'edge-del-v2.pages';

    // 1. SSR through Nuxt nitro.
    const ssrResponse = await (nitro as any).fetch(request, env, ctx);

    const ct = ssrResponse.headers.get('content-type') || '';
    const isHtml200 =
      ssrResponse.status === 200 && ct.toLowerCase().includes('text/html');
    if (!isHtml200) return ssrResponse;

    // Control mode: skip Optimizely entirely, return the Nuxt SSR.
    if (!variation) {
      const stamped = new Response(ssrResponse.body, ssrResponse);
      stamped.headers.set(
        'x-edge-del-v2',
        `mode=pages-integrated; snippet=${env.SNIPPET_ID || 'none'}; variation=off; reinforce=n/a; build=${labBuild}`
      );
      return stamped;
    }

    if (!env.SNIPPET_ID) {
      const stamped = new Response(ssrResponse.body, ssrResponse);
      stamped.headers.set(
        'x-edge-del-v2',
        `mode=pages-integrated; snippet=none; reinforce=${reinforce ? 'on' : 'off'}; build=${labBuild}`
      );
      return stamped;
    }

    // 2. Hand SSR Response to Edge Delivery as `control`.
    const options = {
      snippetId: env.SNIPPET_ID,
      environment: 'prod',
      control: ssrResponse,
      logLevel: env.DEBUG === 'true' ? 'debug' : 'error'
    } as unknown as Options;

    let response: Response;
    try {
      response = await applyExperiments(request, ctx, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('applyExperiments error', msg);
      const fallback = await (nitro as any).fetch(request, env, ctx);
      const stamped = new Response(fallback.body, fallback);
      stamped.headers.set(
        'x-edge-del-v2',
        `mode=pages-integrated; sdk-error=${encodeURIComponent(msg)}; build=${labBuild}`
      );
      return stamped;
    }

    // 3. Inject companion + manifest, when reinforce=on.
    if (reinforce) {
      const bodyText = await response.text();
      const ops = await buildOpsFromManifest(bodyText, env.SNIPPET_ID);
      const manifest: VariationManifest = {
        caseId: 'sdk-mode',
        appliedAt: 'edge',
        buildId: labBuild,
        ops
      };
      const manifestJson = JSON.stringify(manifest).replace(/<\/script/gi, '<\\/script');
      const tag =
        `<script type="application/json" id="${MANIFEST_TAG_ID}">${manifestJson}</script>` +
        `<script id="${COMPANION_TAG_ID}">${COMPANION_SOURCE}</script>`;
      const closing = bodyText.lastIndexOf('</body>');
      const withTag = closing >= 0
        ? bodyText.slice(0, closing) + tag + bodyText.slice(closing)
        : bodyText + tag;
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      response = new Response(withTag, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    const stamped = new Response(response.body, response);
    stamped.headers.set(
      'x-edge-del-v2',
      `mode=pages-integrated; snippet=${env.SNIPPET_ID}; variation=on; reinforce=${reinforce ? 'on' : 'off'}; build=${labBuild}`
    );
    return stamped;
  }
};
