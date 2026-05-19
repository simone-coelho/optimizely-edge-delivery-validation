// Entry — dispatches between MODE=local (Mode B) and MODE=sdk (Mode A).
//
// Mode B is the workhorse for harness runs: cases authored in
// edge-del-v2/experiments/*.json drive HTMLRewriter ops, then the
// reinforcement passes annotate and inject the companion.
//
// Mode A wraps @optimizely/edge-delivery and demos the SDK pipeline. The
// companion is still injected so the harness can assert pre-hydration vs
// post-hydration parity.
//
// Both modes return an x-edge-del-v2 response header so the harness can
// verify it actually went through this worker.

import { handleLocal } from './modes/local';
import { handleSdk } from './modes/sdk';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Health probe — keep it cheap and explicit.
    const url = new URL(request.url);
    if (url.pathname === '/__edge-del-v2/health') {
      return new Response(JSON.stringify({
        ok: true,
        mode: env.MODE,
        build: env.LAB_BUILD,
        origin: env.PAGES_ORIGIN
      }), { headers: { 'content-type': 'application/json' } });
    }

    try {
      switch (env.MODE) {
        case 'sdk':   return await handleSdk(request, env, ctx);
        case 'local': return await handleLocal(request, env, ctx);
        default:      return await handleLocal(request, env, ctx);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (env.DEBUG === 'true') {
        return new Response(`edge-del-v2 worker error: ${msg}`, { status: 500 });
      }
      // Fail open — Layer C philosophy. Return a barebones passthrough so
      // we never blank the page; the error is logged via wrangler tail.
      console.error('edge-del-v2 worker error', err);
      return fetch(request);
    }
  }
};
