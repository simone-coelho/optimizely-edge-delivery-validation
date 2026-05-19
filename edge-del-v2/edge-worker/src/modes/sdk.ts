// Mode A — call @optimizely/edge-delivery's applyExperiments() with a
// pre-fetched origin Response (passed via options.control). The SDK uses
// the control instead of doing its own fetch, which matters because our
// lab worker runs on *.workers.dev where there is no fallthrough origin
// to receive a fetch(request.url) subrequest.
//
// We then layer the companion injector when ?reinforce=on. The companion
// today carries a sentinel manifest (caseId='sdk-mode', ops=[]) because
// the Optimizely-manifest parser hasn't shipped yet — the companion
// boots, logs its presence, and no-ops until the parser feeds it the
// real per-request op list.

import { applyExperiments, Options } from '@optimizely/edge-delivery';
import { fetchOrigin } from '../origin';
import { inject } from '../reinforce/injector';
import type { VariationManifest } from '../types';

export async function handleSdk(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.SNIPPET_ID) {
    return new Response(
      'MODE=sdk requires SNIPPET_ID env var.',
      { status: 500, headers: { 'content-type': 'text/plain' } }
    );
  }

  const reinforce = new URL(request.url).searchParams.get('reinforce') !== 'off';

  // Pre-fetch the SSR origin (Pages) and pass as control. The SDK will
  // skip its own fetch when options.control is provided.
  const control = await fetchOrigin(request, env, ctx);
  if (control.status !== 200) {
    const stamped = new Response(control.body, control);
    stamped.headers.set('x-edge-del-v2', `mode=sdk; origin-status=${control.status}; build=${env.LAB_BUILD}`);
    return stamped;
  }

  const options = {
    snippetId: env.SNIPPET_ID,
    environment: env.EDGE_ENV,
    control,
    logLevel: env.DEBUG === 'true' ? 'debug' : 'error'
  } as unknown as Options;

  let response: Response;
  try {
    response = await applyExperiments(request, ctx, options);
  } catch (err) {
    // Fail open — return the origin untouched if the SDK throws.
    const msg = err instanceof Error ? err.message : String(err);
    const fallback = await fetchOrigin(request, env, ctx);
    const stamped = new Response(fallback.body, fallback);
    stamped.headers.set('x-edge-del-v2', `mode=sdk; sdk-error=${encodeURIComponent(msg)}; build=${env.LAB_BUILD}`);
    return stamped;
  }

  const ct = response.headers.get('content-type') || '';
  if (response.status !== 200 || !ct.toLowerCase().includes('text/html')) {
    return response;
  }

  if (reinforce) {
    const sentinel: VariationManifest = {
      caseId: 'sdk-mode',
      appliedAt: 'edge',
      buildId: env.LAB_BUILD,
      ops: []
    };
    response = inject(response, sentinel);
  }

  const stamped = new Response(response.body, response);
  stamped.headers.set(
    'x-edge-del-v2',
    `mode=sdk; snippet=${env.SNIPPET_ID}; reinforce=${reinforce ? 'on' : 'off'}; build=${env.LAB_BUILD}`
  );
  return stamped;
}
