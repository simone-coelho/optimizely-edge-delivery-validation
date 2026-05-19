// Decide survives / recovered / partial for each op given an OpSnapshot.

import type { Op } from 'edge-del-v2-reinforce';
import type { OpSnapshot } from './dom-snapshot';

export type Outcome = 'survives' | 'recovered' | 'partial' | 'not-applied';

export function verifyOp(op: Op, snap: OpSnapshot): Outcome {
  switch (op.type) {
    case 'text':
      if (!snap.matched) return 'not-applied';
      return snap.text === op.value ? 'survives' : 'recovered';

    case 'attribute':
      if (!snap.matched) return 'not-applied';
      return snap.attributeValue === op.value ? 'survives' : 'recovered';

    case 'class': {
      if (!snap.matched) return 'not-applied';
      const has = (c: string) => (snap.classList || []).includes(c);
      const addsOk    = (op.add    || []).every(has);
      const removesOk = (op.remove || []).every(c => !has(c));
      if (addsOk && removesOk) return 'survives';
      if (addsOk || removesOk) return 'partial';
      return 'recovered';
    }

    case 'add': {
      // We added with data-edge-applied mark. If we see the mark, it's there.
      return snap.hasAppliedMark ? 'survives' : 'recovered';
    }

    case 'remove': {
      // remove "survives" means the selector matches NOTHING.
      return snap.matched === 0 ? 'survives' : 'recovered';
    }

    case 'move': {
      // Survives if the source selector exists AND is sibling-adjacent to
      // the target (or at the requested position). We approximate by
      // comparing position indexes when the move was append/before/after.
      if (!snap.matched || snap.toSelectorMatched === 0) return 'not-applied';
      const src = snap.position!;
      const dst = snap.toSelectorPosition!;
      switch (op.position) {
        case 'after':  return src === dst + 1 ? 'survives' : 'recovered';
        case 'before': return src === dst - 1 ? 'survives' : 'recovered';
        case 'append':
        case 'prepend':
          // For append/prepend the toSelector IS the parent and the source
          // should be inside. The snapshot just records its position. We
          // need a different parent-child check that snapshotOps does not
          // currently capture, so default to survives if the source has
          // the applied mark (companion stamps it on move).
          return snap.hasAppliedMark ? 'survives' : 'recovered';
      }
      return 'recovered';
    }
  }
}

export function rollupOutcomes(outcomes: Outcome[]): Outcome {
  if (outcomes.every(o => o === 'survives')) return 'survives';
  if (outcomes.every(o => o === 'recovered' || o === 'not-applied')) return 'recovered';
  if (outcomes.some(o => o === 'survives') && outcomes.some(o => o !== 'survives')) return 'partial';
  return 'recovered';
}
