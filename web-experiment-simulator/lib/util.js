/**
 * Shared utilities — colors, concurrency pool, seeded RNG, helpers.
 * Pure Node 18+, no dependencies.
 */
'use strict';

const { randomUUID } = require('crypto');

// ─── ANSI colors ────────────────────────────────────────────────────────────
const bold   = function (s) { return '\x1b[1m'  + s + '\x1b[0m'; };
const green  = function (s) { return '\x1b[32m' + s + '\x1b[0m'; };
const red    = function (s) { return '\x1b[31m' + s + '\x1b[0m'; };
const cyan   = function (s) { return '\x1b[36m' + s + '\x1b[0m'; };
const gray   = function (s) { return '\x1b[90m' + s + '\x1b[0m'; };
const yellow = function (s) { return '\x1b[33m' + s + '\x1b[0m'; };

// ─── Seeded RNG (mulberry32) ──────────────────────────────────────────────────
// Deterministic so a given seed reproduces the exact same synthetic population.
function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Concurrency pool (same pattern as the soak test) ─────────────────────────
async function runConcurrent(tasks, limit) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
  return results;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function uuid() { return randomUUID(); }

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

module.exports = {
  bold, green, red, cyan, gray, yellow,
  makeRng, runConcurrent, chunk, uuid, pad, padL,
};
