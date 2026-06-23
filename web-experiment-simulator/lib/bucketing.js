/**
 * Variation assignment — two modes.
 *
 *  "weighted"   (default): weighted-random pick per the variation `weight`s.
 *               Lets you manufacture an exact split and is all the stats engine
 *               needs (it only sees the resulting decision per visitor).
 *
 *  "murmurhash" (authentic): reproduces Optimizely's real bucketing —
 *               murmur32(visitorId + experimentId, seed=1) mapped to the
 *               experiment's traffic-allocation ranges. Deterministic and
 *               sticky: the same visitorId always lands in the same variation,
 *               exactly as the browser snippet would compute it.
 */
'use strict';

const { murmurhash3_32 } = require('./murmur');

const HASH_SEED = 1;
const MAX_HASH_VALUE = Math.pow(2, 32);
const MAX_TRAFFIC_VALUE = 10000;

function bucketValue(bucketingId, parentId) {
  const hash = murmurhash3_32('' + bucketingId + parentId, HASH_SEED);
  return Math.floor((hash / MAX_HASH_VALUE) * MAX_TRAFFIC_VALUE);
}

// Cumulative allocation endpoints out of 10000, derived from variation weights.
function buildAllocations(variations) {
  const total = variations.reduce(function (s, v) { return s + (v.weight != null ? v.weight : 0); }, 0)
    || variations.length;
  let cum = 0;
  return variations.map(function (v, i) {
    const w = v.weight != null ? v.weight : (total / variations.length);
    cum += (w / total) * MAX_TRAFFIC_VALUE;
    // Last variation absorbs rounding so the final endpoint is exactly 10000.
    const end = (i === variations.length - 1) ? MAX_TRAFFIC_VALUE : Math.round(cum);
    return { id: v.id, end: end };
  });
}

function assignMurmur(visitorId, exp) {
  if (!exp._allocations) exp._allocations = buildAllocations(exp.variations);
  const b = bucketValue(visitorId, exp.experiment_id);
  for (const a of exp._allocations) {
    if (b < a.end) return a.id;
  }
  return exp._allocations[exp._allocations.length - 1].id;
}

function assignWeighted(variations, rng) {
  const total = variations.reduce(function (s, v) { return s + (v.weight != null ? v.weight : 0); }, 0)
    || variations.length;
  let r = rng() * total;
  for (const v of variations) {
    r -= (v.weight != null ? v.weight : total / variations.length);
    if (r < 0) return v.id;
  }
  return variations[variations.length - 1].id;
}

function assignVariation(visitorId, exp, mode, rng) {
  return mode === 'murmurhash'
    ? assignMurmur(visitorId, exp)
    : assignWeighted(exp.variations, rng);
}

module.exports = {
  assignVariation, assignMurmur, assignWeighted, bucketValue, buildAllocations,
  HASH_SEED, MAX_TRAFFIC_VALUE,
};
