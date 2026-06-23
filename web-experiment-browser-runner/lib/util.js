'use strict';
const fs = require('fs');

// ANSI colors
const c = {
  bold:   s => '\x1b[1m'  + s + '\x1b[0m',
  green:  s => '\x1b[32m' + s + '\x1b[0m',
  red:    s => '\x1b[31m' + s + '\x1b[0m',
  cyan:   s => '\x1b[36m' + s + '\x1b[0m',
  gray:   s => '\x1b[90m' + s + '\x1b[0m',
  yellow: s => '\x1b[33m' + s + '\x1b[0m',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Resilient writes: the Windows filesystem under WSL (/mnt/c) intermittently
// throws EACCES when another process briefly locks a file. A dropped progress
// line must never crash a multi-hour run, so these swallow transient errors.
function appendJsonl(file, obj) {
  try { fs.appendFileSync(file, JSON.stringify(obj) + '\n'); } catch (e) { /* transient FS lock — skip */ }
}

function safeWriteFile(file, str) {
  try { fs.writeFileSync(file, str); return true; } catch (e) { return false; }
}

function pad(s, n)  { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

// Shared rate gate: enforces a minimum interval between visit starts (combining
// an explicit per-start delay and an optional max-per-minute cap).
function makeStartGate(minDelayMs, maxPerMinute) {
  let nextAllowed = Date.now();
  const minByRate = maxPerMinute > 0 ? 60000 / maxPerMinute : 0;
  const interval = Math.max(minDelayMs || 0, minByRate);
  return async function gate() {
    if (interval <= 0) return;
    const now = Date.now();
    const slot = Math.max(now, nextAllowed);
    nextAllowed = slot + interval;
    const wait = slot - now;
    if (wait > 0) await sleep(wait);
  };
}

module.exports = { c, sleep, appendJsonl, safeWriteFile, pad, padL, makeStartGate };
