// Shared types — used by the worker, the companion script, and the
// harness. Kept here because reinforce/ has the least surface and is the
// natural home for the manifest/op vocabulary. Both edge-worker and
// harness depend on this package.

export type OpType = 'text' | 'attribute' | 'class' | 'add' | 'remove' | 'move';

export type Op =
  | { type: 'text';      selector: string; value: string }
  | { type: 'attribute'; selector: string; name: string; value: string }
  | { type: 'class';     selector: string; add?: string[]; remove?: string[] }
  | { type: 'add';       selector: string; html: string; position: 'before' | 'after' | 'prepend' | 'append' | 'replace' }
  | { type: 'remove';    selector: string }
  | { type: 'move';      selector: string; toSelector: string; position: 'before' | 'after' | 'prepend' | 'append' };

export interface VariationManifest {
  caseId: string;
  appliedAt: 'edge';
  buildId: string;
  ops: Op[];
}

export interface Case {
  id: string;
  name: string;
  bucket: 'safe' | 'fragile' | 'graceful' | 'mixed';
  pathMatch: string | '*';
  notes: string;
  ops: Op[];
  expected: {
    withoutReinforcement: 'survives' | 'recovered' | 'partial';
    withReinforcement:    'survives' | 'recovered' | 'partial';
  };
}
