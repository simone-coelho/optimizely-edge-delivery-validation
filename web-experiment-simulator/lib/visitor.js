/**
 * Visitor identity. Optimizely Web stores a random end-user id in the
 * `optimizelyEndUserId` cookie with the shape:  oeu<ms>r<fraction>
 *   e.g.  oeu1717718400000r0.5728449280353972
 * The <ms> is roughly when the cookie was first set, so we anchor it shortly
 * before the visitor's activation time for realism. Any unique string is a
 * distinct visitor to the stats engine; the format just makes the data look
 * like genuine snippet traffic.
 */
'use strict';

function newVisitorId(rng, anchorMs) {
  // Cookie-set time: up to 7 days before the visitor's day. Anchor to a fixed
  // point (e.g. the activation day-start), NOT wall-clock now, so a given seed
  // reproduces identical ids — which matters for deterministic murmurhash bucketing.
  const base = (anchorMs ? anchorMs : Date.now()) - Math.floor(rng() * 7 * 86400000);
  const frac = String(rng()).slice(1); // ".xxxx…"
  return 'oeu' + base + 'r0' + frac;
}

module.exports = { newVisitorId };
