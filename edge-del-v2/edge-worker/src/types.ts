// Re-export the shared types from the reinforce package so the worker
// has a single source of truth on Op / Case / VariationManifest.
export type { Op, OpType, VariationManifest, Case } from 'edge-del-v2-reinforce';
