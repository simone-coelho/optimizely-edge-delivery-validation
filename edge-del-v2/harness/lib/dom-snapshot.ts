// Snapshot per-op DOM state from inside the page context. Returns enough
// detail for verifyOp() to decide survives / recovered / partial without
// needing a full DOM tree.

import type { Page } from 'playwright';
import type { Op } from 'edge-del-v2-reinforce';

export interface OpSnapshot {
  index: number;
  type: string;
  selector: string;
  matched: number;
  text?: string;
  attributeValue?: string;
  classList?: string[];
  hasAppliedMark: boolean;
  companionInserted: boolean;
  position?: number;
  toSelectorMatched?: number;
  toSelectorPosition?: number;
}

export async function snapshotOps(page: Page, caseId: string, ops: Op[]): Promise<OpSnapshot[]> {
  return await page.evaluate(([caseId, ops]) => {
    const out: OpSnapshot[] = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i] as Op;
      const sel = op.selector;
      const nodes = Array.from(document.querySelectorAll(sel));
      const mark = `${caseId}__${i}`;
      const marked = document.querySelectorAll('[data-edge-applied="' + mark + '"]');
      const snap: OpSnapshot = {
        index: i,
        type: op.type,
        selector: sel,
        matched: nodes.length,
        hasAppliedMark: marked.length > 0,
        companionInserted: !!Array.from(marked).find(n => n.getAttribute('data-edge-companion-inserted') === '1')
      };
      if (op.type === 'text' && nodes[0]) snap.text = nodes[0].textContent || '';
      if (op.type === 'attribute' && nodes[0]) snap.attributeValue = nodes[0].getAttribute(op.name) || '';
      if (op.type === 'class' && nodes[0]) snap.classList = Array.from(nodes[0].classList);
      if (op.type === 'add' && nodes[0]) {
        // Count children that look like additions (matching the applied mark).
        snap.position = Array.from(nodes[0].parentElement?.children || []).indexOf(nodes[0]);
      }
      if (op.type === 'move' && nodes[0]) {
        const parent = nodes[0].parentElement!;
        snap.position = Array.from(parent.children).indexOf(nodes[0]);
        const targets = document.querySelectorAll(op.toSelector);
        snap.toSelectorMatched = targets.length;
        snap.toSelectorPosition = targets[0]
          ? Array.from(targets[0].parentElement?.children || []).indexOf(targets[0] as Element)
          : -1;
      }
      out.push(snap);
    }
    return out;
  }, [caseId, ops] as const);
}
