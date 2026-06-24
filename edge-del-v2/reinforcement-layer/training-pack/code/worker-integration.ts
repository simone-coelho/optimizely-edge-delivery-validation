// Edge-worker post-processor for Optimizely Edge Delivery on hydrating
// SSR sites (Vue 3 / Nuxt 3, React 18 / Next.js, etc.).
//
// Paste this file into your worker source tree alongside your existing
// Cloudflare worker entry. Wire it in by replacing the body of your
// existing `fetch` handler with the `handleRequestWithReinforcement`
// function below (or copy the function body inline — whichever your
// codebase prefers).
//
// What it does, in five steps:
//   1. Calls your SSR handler → SSR Response.
//   2. Calls applyExperiments() from @optimizely/edge-delivery → the
//      Optimizely SDK applies bucketed variation changes via HTMLRewriter.
//   3. Reads the response body, finds every `data-optly-<changeId>`
//      marker the SDK left, cross-references with the project manifest
//      from cdn.optimizely.com (cached at the same Cloudflare edge that
//      already cached it for the SDK), builds a typed `Op[]`.
//   4. Injects two <script> tags before </body>:
//        - <script type="application/json" id="optly-companion-manifest">
//            the ops the companion should replay
//        - <script id="optly-companion">
//            the companion IIFE itself
//   5. Returns the assembled Response.
//
// The companion script is delivered inline in the response — no extra
// HTTP request, no DNS lookup, no TLS handshake. The whole package adds
// under 10 KB to the SSR response (under 2 KB gzipped).

import { applyExperiments, Options } from '@optimizely/edge-delivery';

// Provide COMPANION_SOURCE via your build pipeline. The
// `build-companion.mjs` script in this same folder produces a
// `companion-source.mjs` file that exports COMPANION_SOURCE as a
// string. Import path will look like:
//
//     import { COMPANION_SOURCE } from './companion-source.mjs';
//
// If your worker bundler can inline raw text (esbuild's `text` loader,
// webpack's `raw-loader`, vite's `?raw` suffix), you can instead do:
//
//     import COMPANION_SOURCE from './companion.min.js?raw';
//
// Either way, COMPANION_SOURCE ends up as a string at module scope.
declare const COMPANION_SOURCE: string;

const MANIFEST_TAG_ID  = 'optly-companion-manifest';
const COMPANION_TAG_ID = 'optly-companion';

// ── Op vocabulary ──────────────────────────────────────────────────────
// Mirrors `types.ts` in this same folder. Kept here so this file is
// self-contained for engineers who paste it directly.
type Op =
  | { type: 'text';      selector: string; value: string }
  | { type: 'attribute'; selector: string; name: string; value: string }
  | { type: 'class';     selector: string; add?: string[]; remove?: string[] }
  | { type: 'add';       selector: string; html: string; position: 'before' | 'after' | 'prepend' | 'append' | 'replace' }
  | { type: 'remove';    selector: string }
  | { type: 'move';      selector: string; toSelector: string; position: 'before' | 'after' | 'prepend' | 'append' };

interface VariationManifest {
  appliedAt: 'edge';
  ops: Op[];
}

// ── Manifest-based op builder ──────────────────────────────────────────
//
// The Optimizely SDK tags every modified element with
// `data-optly-<changeId>`. We scan the response body for those markers,
// fetch the project manifest from cdn.optimizely.com (cache-hit on the
// CF edge — same one the SDK just hit), and translate each change into
// our Op vocabulary.

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
      if (attrs.text   !== undefined) ops.push({ type: 'text',      selector, value: String(attrs.text) });
      if (attrs.class  !== undefined) ops.push({ type: 'attribute', selector, name: 'class', value: String(attrs.class) });
      if (attrs.html   !== undefined) ops.push({ type: 'add',       selector, html: String(attrs.html), position: 'replace' });
      if (attrs.href   !== undefined) ops.push({ type: 'attribute', selector, name: 'href',   value: String(attrs.href) });
      if (attrs.src    !== undefined) ops.push({ type: 'attribute', selector, name: 'src',    value: String(attrs.src) });
      if (attrs.srcset !== undefined) ops.push({ type: 'attribute', selector, name: 'srcset', value: String(attrs.srcset) });
      if (attrs.style  !== undefined) ops.push({ type: 'attribute', selector, name: 'style',  value: String(attrs.style) });
      if (attrs.hide   === true)      ops.push({ type: 'attribute', selector, name: 'style',  value: 'display:none' });
      if (attrs.remove === true)      ops.push({ type: 'remove',    selector });
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
      // JS could re-run side effects. The Optimizely SDK ships
      // custom_code as a separate <script> tag in the SSR response; that
      // script is responsible for being defensive about re-runs (e.g.
      // using a MutationObserver to re-wire on DOM re-insertion).
      return [];

    default:
      return [];
  }
}

async function fetchManifest(snippetId: string): Promise<any | null> {
  const url = `https://cdn.optimizely.com/js/web_sdk_v0_${snippetId}.json`;
  try {
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

  // Pass 1 — for each marker present in the body, look up its change.
  for (const id of markerIds) {
    const change = byId.get(id);
    if (!change) continue;
    seenChangeIds.add(id);
    for (const op of changeToOps(change)) ops.push(op);
  }

  // Pass 2 — rearrange changes don't add their own marker (they declare
  // a dependency on a scaffolding-attribute change that does). If any
  // rearrange's dependency overlaps our markers, emit its op too.
  for (const change of allChanges) {
    if (change.type !== 'rearrange') continue;
    const deps = (change.dependencies || []).map((d: any) => String(d).toLowerCase());
    if (!deps.some((d: string) => markerIds.has(d))) continue;
    if (seenChangeIds.has(String(change.id || '').toLowerCase())) continue;
    for (const op of changeToOps(change)) ops.push(op);
  }

  return ops;
}

// ── The wrapper your fetch handler calls ───────────────────────────────
//
// `ssrFetch` is your existing SSR handler — Nuxt's nitro, Next's
// edge handler, or whatever produces the unmodified SSR HTML Response.
// Everything else is parameter-free.

export interface ReinforceEnv {
  SNIPPET_ID: string;  // your Optimizely project's snippet id
}

export async function handleRequestWithReinforcement(
  request: Request,
  env:     ReinforceEnv,
  ctx:     ExecutionContext,
  ssrFetch: (req: Request) => Promise<Response>
): Promise<Response> {
  // (1) SSR
  const ssrResponse = await ssrFetch(request);

  const ct = ssrResponse.headers.get('content-type') || '';
  if (ssrResponse.status !== 200 || !ct.toLowerCase().includes('text/html')) {
    return ssrResponse;
  }

  // (2) Buffer the SSR body once. Two reasons:
  //
  //   (a) `applyExperiments` accepts `control` as a Response and reads
  //       its body lazily via an HTMLRewriter transform. If the SDK
  //       throws partway through reading the stream, the original SSR
  //       response is in an indeterminate consumption state and cannot
  //       be safely returned to the client (Workers' Response model
  //       only allows reading a body stream once). The SDK itself
  //       validates `control.bodyUsed` and warns "Control passed body
  //       is already used" — confirmation that this is the failure
  //       mode we are protecting against.
  //
  //   (b) Buffering at the top means the error fallback can reuse the
  //       same buffered body to construct a fresh Response, avoiding a
  //       re-fetch from origin (which would double origin load on the
  //       error path).
  //
  // Memory cost is bounded by the response size: ~0.04–0.4% of the
  // Cloudflare Workers 128 MB isolate limit for typical SSR HTML
  // payloads (50–500 KB). For unusually large responses, an alternative
  // pattern is to re-fetch from origin in the catch block — but accept
  // the doubled origin load when the SDK errors.
  const ssrBody       = await ssrResponse.text();
  const ssrStatus     = ssrResponse.status;
  const ssrStatusText = ssrResponse.statusText;
  const ssrHeaders    = new Headers(ssrResponse.headers);
  const freshSsr      = (): Response => new Response(ssrBody, {
    status:     ssrStatus,
    statusText: ssrStatusText,
    headers:    ssrHeaders,
  });

  // (3) Edge Delivery — control is a freshly constructed Response, so
  // even if the SDK partially consumes its stream and throws, the
  // buffered `ssrBody` remains available for the error fallback.
  const options = {
    snippetId:   env.SNIPPET_ID,
    environment: 'prod',
    control:     freshSsr(),
  } as unknown as Options;

  let response: Response;
  try {
    response = await applyExperiments(request, ctx, options);
  } catch (err) {
    // SDK error → fall open with a fresh Response constructed from the
    // buffered body. No origin re-fetch.
    console.error('applyExperiments error', err instanceof Error ? err.message : err);
    return freshSsr();
  }

  // (4) Build the companion's manifest from the variation-applied body.
  const body = await response.text();
  const ops  = await buildOpsFromManifest(body, env.SNIPPET_ID);

  // (5) Inject the manifest JSON tag + the companion <script>.
  const manifest: VariationManifest = { appliedAt: 'edge', ops };
  const manifestJson = JSON.stringify(manifest).replace(/<\/script/gi, '<\\/script');

  const injection =
    `<script type="application/json" id="${MANIFEST_TAG_ID}">${manifestJson}</script>` +
    `<script id="${COMPANION_TAG_ID}">${COMPANION_SOURCE}</script>`;

  const closing = body.lastIndexOf('</body>');
  const newBody = closing >= 0
    ? body.slice(0, closing) + injection + body.slice(closing)
    : body + injection;

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('x-optly-reinforce', 'on');  // optional: diagnostic header

  return new Response(newBody, {
    status:     response.status,
    statusText: response.statusText,
    headers
  });
}
