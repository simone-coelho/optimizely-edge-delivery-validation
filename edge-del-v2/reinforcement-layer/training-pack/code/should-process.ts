// Filters out requests that shouldn't be processed by the
// reinforcement worker — assets, framework internals, API JSON,
// third-party callbacks. Returns true only for requests that have a
// realistic chance of being HTML the variation can land in.
//
// Sits in front of `handleRequestWithReinforcement`. Costs a few
// hundred microseconds of worker CPU on the bypass path. Cloudflare
// bills CPU time, not wall time, so an empty passthrough is
// effectively free.
//
// First-line filtering should be done at the route level —
// `_routes.json` for Pages, `wrangler.toml` routes for standalone
// Workers — so most asset requests never invoke the worker at all.
// This file is the second line of defence for requests that slip
// past those route rules.
//
// See `training-pack/4-deployment-routing.md` for the full
// three-layer model and verification checklist.

// Common static-asset file extensions. Anchored to the end of the
// pathname (with optional query string). Does NOT include `html` or
// `htm` — those are valid HTML pages.
const ASSET_EXTENSION_RE =
  /\.(js|mjs|css|map|json|xml|txt|csv|pdf|png|jpe?g|gif|svg|ico|webp|avif|bmp|tiff?|woff2?|ttf|otf|eot|mp[34]|m4[av]|webm|wav|ogg|flac|zip|gz|br|wasm)(\?.*)?$/i;

// Path prefixes that frameworks reserve for internal endpoints.
// These never serve experiment-eligible HTML. Add the customer's own
// /api/ prefix if their API never returns HTML.
const FRAMEWORK_PREFIXES = [
  '/_nuxt/',          // Nuxt 3 assets and chunks
  '/__nuxt_island/',  // Nuxt 3 island RPCs
  '/__nuxt_error',    // Nuxt 3 error overlay
  '/_payload',        // Nuxt 3 payload prefetch
  '/_next/',          // Next.js (Pages & App Router) assets, data, image, rsc
  '/_app/',           // SvelteKit
  '/_astro/',         // Astro
  '/api/',            // remove this line if /api/ ever returns HTML
  '/.well-known/',
  '/cdn-cgi/',        // Cloudflare's own internals
];

export function shouldProcess(request: Request): boolean {
  // Only verbs that can return HTML worth modifying.
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;

  const url = new URL(request.url);

  // Asset extension at the end of the path.
  if (ASSET_EXTENSION_RE.test(url.pathname)) return false;

  // Framework-internal endpoints.
  if (FRAMEWORK_PREFIXES.some(p => url.pathname.startsWith(p))) return false;

  // Accept header sanity — if the client isn't asking for HTML,
  // skip. Browsers asking for HTML send
  // 'text/html,application/xhtml+xml,…'. fetch() and background
  // pings usually do not.
  const accept = request.headers.get('accept') || '';
  if (accept && !accept.includes('text/html') && !accept.includes('*/*')) {
    return false;
  }

  return true;
}
