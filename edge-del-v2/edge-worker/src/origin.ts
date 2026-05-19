// Resolve the origin request URL — point at PAGES_ORIGIN, preserve the
// path and query, strip conditional headers so we never accept a 304 (same
// guard the @optimizely/edge-delivery SDK applies in MODE=sdk).
export function buildOriginRequest(request: Request, env: Env): Request {
  const requestUrl = new URL(request.url);
  const originUrl = new URL(env.PAGES_ORIGIN);

  // Replace host + port + protocol, keep path and search.
  requestUrl.protocol = originUrl.protocol;
  requestUrl.host = originUrl.host;
  requestUrl.port = originUrl.port;

  const headers = new Headers(request.headers);
  // Same Layer B strip the SDK does — never let the origin return 304.
  headers.delete('If-None-Match');
  headers.delete('If-Modified-Since');
  headers.delete('If-Unmodified-Since');
  headers.delete('If-Range');
  // Pages may filter by Host header — set it to the origin host explicitly.
  headers.set('Host', originUrl.host);
  // Mark passes through us so a debug response header can identify it.
  headers.set('X-Edge-Del-V2', '1');

  return new Request(requestUrl.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual'
  });
}

export async function fetchOrigin(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const originReq = buildOriginRequest(request, env);
  return await fetch(originReq);
}
