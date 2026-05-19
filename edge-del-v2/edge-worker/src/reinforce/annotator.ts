// HTMLRewriter pass that adds data-allow-mismatch annotations to the
// elements targeted by edge-applied ops. Vue 3.5+ uses this attribute to
// suppress hydration mismatch warnings AND to leave the existing DOM in
// place rather than aggressively recovering — the entire purpose of this
// pass is to stop Vue from undoing the safe change types (text, attribute,
// class) the moment the page hydrates.
//
// Scope mapping per the Vue 3.5 spec (see optimizely_guidance.txt §3):
//   text → 'text'         (text content mismatch)
//   attribute (class) → 'class'
//   attribute (other) → 'attribute'
//   class op → 'class'
//   add/remove/move → annotation alone is not sufficient; the companion
//                     re-applies these post-hydration. We annotate the
//                     parent with 'children' so Vue tolerates extra/missing
//                     children if the companion has not yet run.

import type { Op } from '../types';

interface AnnotationPlan {
  selector: string;
  scope: 'text' | 'attribute' | 'class' | 'children';
}

function planFromOp(op: Op): AnnotationPlan | null {
  switch (op.type) {
    case 'text':
      return { selector: op.selector, scope: 'text' };
    case 'attribute':
      return { selector: op.selector, scope: op.name === 'class' ? 'class' : 'attribute' };
    case 'class':
      return { selector: op.selector, scope: 'class' };
    case 'add':
    case 'remove':
    case 'move':
      // For structural ops we annotate the closest stable parent so Vue
      // tolerates a children-count mismatch. We can't pinpoint the parent
      // from a selector alone in an HTMLRewriter pass, so we annotate the
      // target's selector AND we rely on the companion to handle these
      // cases post-hydration.
      return { selector: op.selector, scope: 'children' };
  }
}

export function annotate(response: Response, ops: Op[]): Response {
  const plans = ops.map(planFromOp).filter((p): p is AnnotationPlan => p !== null);

  // De-duplicate by selector — pick the broadest scope per selector so a
  // single annotation can cover multiple ops that target the same element.
  const broadest: Record<string, AnnotationPlan['scope']> = {};
  const priority: Record<AnnotationPlan['scope'], number> = {
    'text': 1, 'attribute': 2, 'class': 2, 'children': 3
  };
  for (const p of plans) {
    const cur = broadest[p.selector];
    if (!cur || priority[p.scope] > priority[cur]) broadest[p.selector] = p.scope;
  }

  let rewriter = new HTMLRewriter();
  for (const [selector, scope] of Object.entries(broadest)) {
    rewriter = rewriter.on(selector, {
      element(el) {
        // If an existing data-allow-mismatch is broader, leave it alone.
        const existing = el.getAttribute('data-allow-mismatch');
        if (existing === '' || existing === scope) return;
        el.setAttribute('data-allow-mismatch', scope);
      }
    });
  }
  return rewriter.transform(response);
}
