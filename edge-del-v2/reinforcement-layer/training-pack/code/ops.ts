// Browser-side primitives for applying each op type. Each function is
// idempotent: it re-establishes the desired state regardless of the
// current DOM state. The companion can therefore loop through every op
// after hydration without tracking which ones Vue recovered against.
//
// Idempotency is achieved via two markers:
//   data-edge-applied="<opMark>"     stamped on every element we mutated
//                                    or inserted. If a node has this marker
//                                    and matches the op, we treat it as
//                                    already done.
//   data-edge-companion-inserted     stamped on nodes the companion
//                                    inserted (vs the worker). Lets us
//                                    dedupe across re-runs.

import type { Op } from './types';

export function opMark(caseId: string, index: number): string {
  return `${caseId}__${index}`;
}

export function applyText(op: Extract<Op, { type: 'text' }>, mark: string): void {
  document.querySelectorAll(op.selector).forEach(el => {
    if (el.textContent !== op.value) {
      el.textContent = op.value;
    }
    el.setAttribute('data-edge-applied', mark);
  });
}

export function applyAttribute(op: Extract<Op, { type: 'attribute' }>, mark: string): void {
  document.querySelectorAll(op.selector).forEach(el => {
    if (el.getAttribute(op.name) !== op.value) {
      el.setAttribute(op.name, op.value);
    }
    el.setAttribute('data-edge-applied', mark);
  });
}

export function applyClass(op: Extract<Op, { type: 'class' }>, mark: string): void {
  document.querySelectorAll(op.selector).forEach(el => {
    (op.remove || []).forEach(c => el.classList.remove(c));
    (op.add || []).forEach(c => el.classList.add(c));
    el.setAttribute('data-edge-applied', mark);
  });
}

// Find an existing instance of a template root in the live DOM.
// Prefers id; falls back to tag+class signature for class-only roots.
function findExistingRoot(root: Element): Element | null {
  if (root.id) {
    return document.getElementById(root.id);
  }
  const classes = Array.from(root.classList);
  if (classes.length > 0) {
    const sel = root.tagName.toLowerCase() + '.' + classes.map(c => CSS.escape(c)).join('.');
    return document.querySelector(sel);
  }
  return null;
}

export function applyAdd(op: Extract<Op, { type: 'add' }>, mark: string): void {
  document.querySelectorAll(op.selector).forEach(anchor => {
    const tpl = document.createElement('template');
    tpl.innerHTML = op.html.trim();
    if (!tpl.content.firstElementChild) return;

    const roots = Array.from(tpl.content.children);

    // Multi-root aware reconciliation. Vue's hydration recovery can
    // drop some roots of a multi-root insertion while keeping others
    // (e.g. it keeps Indeed's #opt-1445 but discards .opt-moo-1399).
    // Walk the template roots in order and either re-stamp the
    // existing instance or splice the missing one back in. Missing
    // roots are inserted after the last seen sibling (or at the
    // original anchor position when none has been seen yet).
    let lastSeen: Element | null = null;
    let insertedFirstAtAnchor = false;

    for (const root of roots) {
      const existing = findExistingRoot(root);
      if (existing) {
        existing.setAttribute('data-edge-applied', mark);
        lastSeen = existing;
        continue;
      }

      const clone = root.cloneNode(true) as Element;
      clone.setAttribute('data-edge-applied', mark);
      clone.setAttribute('data-edge-companion-inserted', '1');

      if (lastSeen && lastSeen.parentElement) {
        // Splice this missing root right after the previous root we
        // already located in the DOM. Preserves template ordering.
        lastSeen.parentElement.insertBefore(clone, lastSeen.nextSibling);
      } else if (!insertedFirstAtAnchor) {
        // No previous root located — drop at the requested anchor
        // position (matches the original op semantics for the first
        // root). Subsequent roots will follow this one.
        switch (op.position) {
          case 'before':  anchor.parentElement?.insertBefore(clone, anchor); break;
          case 'after':   anchor.parentElement?.insertBefore(clone, anchor.nextSibling); break;
          case 'prepend': anchor.insertBefore(clone, anchor.firstChild); break;
          case 'append':  anchor.appendChild(clone); break;
          case 'replace':
            anchor.parentElement?.insertBefore(clone, anchor);
            anchor.remove();
            break;
        }
        insertedFirstAtAnchor = true;
      } else {
        // Fallback: append to the anchor (we already used the anchor
        // position, so subsequent missing roots go after the first).
        anchor.appendChild(clone);
      }
      lastSeen = clone;
    }
  });
}

export function applyRemove(op: Extract<Op, { type: 'remove' }>, _mark: string): void {
  document.querySelectorAll(op.selector).forEach(el => {
    // Only remove elements that weren't companion-inserted (those are ours
    // to manage). Vue could have re-inserted a node we tried to remove.
    if (el.getAttribute('data-edge-companion-inserted') === '1') return;
    el.remove();
  });
}

export function applyMove(op: Extract<Op, { type: 'move' }>, mark: string): void {
  const sources = Array.from(document.querySelectorAll(op.selector));
  const targets = Array.from(document.querySelectorAll(op.toSelector));
  if (!sources.length || !targets.length) return;

  const src = sources[0];
  const dst = targets[0];

  // Idempotency: check whether the source is already at the requested
  // position relative to the destination. If yes, just stamp the mark
  // and return. Avoids thrashing the DOM (and avoids triggering Vue's
  // reactive system) on every SPA-navigation reapply.
  const alreadyInPosition = (() => {
    switch (op.position) {
      case 'before':  return dst.previousElementSibling === src;
      case 'after':   return dst.nextElementSibling === src;
      case 'prepend': return dst.firstElementChild === src;
      case 'append':  return dst.lastElementChild === src;
      default:        return false;
    }
  })();
  if (alreadyInPosition) {
    src.setAttribute('data-edge-applied', mark);
    return;
  }

  switch (op.position) {
    case 'before':  dst.parentElement?.insertBefore(src, dst); break;
    case 'after':   dst.parentElement?.insertBefore(src, dst.nextSibling); break;
    case 'prepend': dst.insertBefore(src, dst.firstChild); break;
    case 'append':  dst.appendChild(src); break;
  }
  src.setAttribute('data-edge-applied', mark);
}

export function applyOp(op: Op, mark: string): void {
  switch (op.type) {
    case 'text':      applyText(op, mark); break;
    case 'attribute': applyAttribute(op, mark); break;
    case 'class':     applyClass(op, mark); break;
    case 'add':       applyAdd(op, mark); break;
    case 'remove':    applyRemove(op, mark); break;
    case 'move':      applyMove(op, mark); break;
  }
}
