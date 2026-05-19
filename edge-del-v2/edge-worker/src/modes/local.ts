// Mode B — apply ops authored locally (edge-del-v2/experiments/*.json)
// via HTMLRewriter, then run the reinforcement passes. No Optimizely
// dependency. This is the workhorse path the harness runs against.

import { fetchOrigin } from '../origin';
import { resolveCase } from '../cases';
import { annotate } from '../reinforce/annotator';
import { inject } from '../reinforce/injector';
import type { Case, Op } from '../types';

export async function handleLocal(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // 1. Resolve the case (query param or cookie). Null → pass through.
  const c = resolveCase(request);

  // The harness uses ?reinforce=off to disable annotator+companion while
  // keeping the ops applied — that's how it measures Vue's recovery
  // behaviour without the safety net.
  const reinforce = new URL(request.url).searchParams.get('reinforce') !== 'off';

  // 2. Fetch the SSR origin.
  let response = await fetchOrigin(request, env, ctx);

  const ct = response.headers.get('content-type') || '';
  // Skip non-HTML — same Layer A check the SDK applies.
  if (response.status !== 200 || !ct.toLowerCase().includes('text/html')) {
    return response;
  }

  // No case → return SSR untouched.
  if (!c) {
    response = stampDebugHeaders(response, env, { mode: 'local', case: 'none', reinforce });
    return response;
  }

  // 3. Apply the case's ops via HTMLRewriter — always, regardless of
  //    reinforce. This is how we exercise "edge-applied" change.
  response = applyOps(response, c.ops, c.id);

  if (reinforce) {
    // 4. Annotate affected subtrees with data-allow-mismatch.
    response = annotate(response, c.ops);

    // 5. Inject manifest + companion script.
    response = inject(response, {
      caseId: c.id,
      appliedAt: 'edge',
      buildId: env.LAB_BUILD,
      ops: c.ops
    });
  }

  // 6. Stick the case via cookie so harness reload paths see the same case.
  response = setCaseCookie(response, c.id);
  response = stampDebugHeaders(response, env, { mode: 'local', case: c.id, reinforce });

  return response;
}

function applyOps(response: Response, ops: Op[], caseId: string): Response {
  let rewriter = new HTMLRewriter();

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    // Mark format must match opMark() in reinforce/src/ops.ts so the
    // companion's idempotency check finds the worker-applied nodes and
    // doesn't re-insert duplicates. See harness verify.ts which also
    // depends on this format.
    const appliedMark = `${caseId}__${i}`;

    switch (op.type) {
      case 'text':
        rewriter = rewriter.on(op.selector, {
          element(el) {
            el.setInnerContent(op.value, { html: false });
            el.setAttribute('data-edge-applied', appliedMark);
          }
        });
        break;

      case 'attribute':
        rewriter = rewriter.on(op.selector, {
          element(el) {
            el.setAttribute(op.name, op.value);
            el.setAttribute('data-edge-applied', appliedMark);
          }
        });
        break;

      case 'class':
        rewriter = rewriter.on(op.selector, {
          element(el) {
            const cur = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
            const set = new Set(cur);
            (op.remove || []).forEach(c => set.delete(c));
            (op.add || []).forEach(c => set.add(c));
            el.setAttribute('class', [...set].join(' '));
            el.setAttribute('data-edge-applied', appliedMark);
          }
        });
        break;

      case 'add':
        rewriter = rewriter.on(op.selector, {
          element(el) {
            const html = `${op.html.replace(/^<([a-z][a-z0-9-]*)/i, `<$1 data-edge-applied="${appliedMark}"`)}`;
            switch (op.position) {
              case 'before':  el.before(html,  { html: true }); break;
              case 'after':   el.after(html,   { html: true }); break;
              case 'prepend': el.prepend(html, { html: true }); break;
              case 'append':  el.append(html,  { html: true }); break;
              case 'replace': el.replace(html, { html: true }); break;
            }
          }
        });
        break;

      case 'remove':
        rewriter = rewriter.on(op.selector, {
          element(el) { el.remove(); }
        });
        break;

      case 'move':
        // HTMLRewriter is streaming and one-pass — true move is awkward.
        // We mark the source and let the companion script perform the move
        // post-hydration; the SSR output keeps the element in its original
        // position with a marker.
        rewriter = rewriter.on(op.selector, {
          element(el) { el.setAttribute('data-edge-move-pending', appliedMark); }
        });
        break;
    }
  }

  return rewriter.transform(response);
}

function setCaseCookie(response: Response, caseId: string): Response {
  const newResp = new Response(response.body, response);
  newResp.headers.append(
    'set-cookie',
    `edge-del-v2-case=${encodeURIComponent(caseId)}; Path=/; SameSite=Lax; Max-Age=3600`
  );
  return newResp;
}

function stampDebugHeaders(
  response: Response,
  env: Env,
  meta: { mode: string; case: string; reinforce: boolean }
): Response {
  const newResp = new Response(response.body, response);
  newResp.headers.set(
    'x-edge-del-v2',
    `mode=${meta.mode}; case=${meta.case}; reinforce=${meta.reinforce ? 'on' : 'off'}; build=${env.LAB_BUILD}`
  );
  return newResp;
}
