// Bundle the experiment catalogue into the worker. Each case is a
// hand-authored JSON file under edge-del-v2/experiments/ and is imported
// here so the worker is fully self-contained.
import case01 from '../../experiments/01-text-content.json' assert { type: 'json' };
import case02 from '../../experiments/02-attribute-only.json' assert { type: 'json' };
import case03 from '../../experiments/03-css-class-toggle.json' assert { type: 'json' };
import case04 from '../../experiments/04-additive-dom.json' assert { type: 'json' };
import case05 from '../../experiments/05-rearrange-unkeyed.json' assert { type: 'json' };
import case06 from '../../experiments/06-rearrange-keyed.json' assert { type: 'json' };
import case07 from '../../experiments/07-stateful-subtree.json' assert { type: 'json' };
import case08 from '../../experiments/08-combination.json' assert { type: 'json' };
import case09 from '../../experiments/09-additive-into-vfor.json' assert { type: 'json' };
import case10 from '../../experiments/10-reactive-binding.json' assert { type: 'json' };
import type { Case } from './types';

export const CASES: Record<string, Case> = {
  [case01.id]: case01 as Case,
  [case02.id]: case02 as Case,
  [case03.id]: case03 as Case,
  [case04.id]: case04 as Case,
  [case05.id]: case05 as Case,
  [case06.id]: case06 as Case,
  [case07.id]: case07 as Case,
  [case08.id]: case08 as Case,
  [case09.id]: case09 as Case,
  [case10.id]: case10 as Case
};

export function resolveCase(request: Request): Case | null {
  const url = new URL(request.url);

  // Priority 1: explicit ?case= query param (harness-controlled).
  const qp = url.searchParams.get('case');
  if (qp && CASES[qp]) return CASES[qp];

  // Priority 2: cookie `edge-del-v2-case`.
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)edge-del-v2-case=([^;]+)/);
  if (m && CASES[m[1]]) return CASES[m[1]];

  return null;
}
