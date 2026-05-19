#!/usr/bin/env node
/**
 * Optimizely Edge Validation Kit — URL Probe
 * ═══════════════════════════════════════════
 * Quick inspector that fetches a URL via raw HTTP and reports everything
 * you need to calibrate the validation scripts: body size, cache headers,
 * HTML structure, and recommended MIN_HTML_BYTES / HTML_MARKER settings.
 *
 * Also performs a return-visit simulation (sends ETag/If-Modified-Since back)
 * to check whether conditional headers are being stripped at the edge.
 *
 * USAGE:
 *   node probe.js https://www.example.com/landing
 *   node probe.js https://www.optimizely.com/ https://www.optimizely.com/pricing
 *
 * REQUIREMENTS: Node.js 18+  (no npm install needed)
 */

'use strict';

const bold   = s => `\x1b[1m${s}\x1b[0m`;
const green  = s => `\x1b[32m${s}\x1b[0m`;
const red    = s => `\x1b[31m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const cyan   = s => `\x1b[36m${s}\x1b[0m`;
const gray   = s => `\x1b[90m${s}\x1b[0m`;

(async () => {

const urls = process.argv.slice(2).filter(a => a.startsWith('http'));

if (!urls.length) {
  console.log(`
${bold('Optimizely Edge Validation Kit — URL Probe')}

${bold('Usage:')}
  node probe.js <url> [url2] ...

${bold('Examples:')}
  node probe.js https://www.example.com/landing
  node probe.js https://www.optimizely.com/ https://www.optimizely.com/pricing

${bold('What it does:')}
  1. Fetches the URL as a new visitor
  2. Reports status, headers, body size, HTML structure
  3. Simulates a returning visitor (conditional headers)
  4. Recommends MIN_HTML_BYTES and HTML_MARKER settings
`);
  process.exit(1);
}

for (const url of urls) {
  console.log('\n' + bold('══════════════════════════════════════════════════════════'));
  console.log(bold('  Probing: ') + cyan(url));
  console.log(bold('══════════════════════════════════════════════════════════'));

  try {
    // ─── First visit (new visitor) ──────────────────────────────────────
    const start = Date.now();
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
      },
      redirect: 'follow',
    });
    const body = await res.text();
    const ms = Date.now() - start;
    const bytes = Buffer.byteLength(body, 'utf8');

    console.log('\n' + bold('  Response'));
    console.log(`  Status:          ${res.status} ${res.statusText}`);
    console.log(`  Content-Type:    ${res.headers.get('content-type') || '(none)'}`);
    console.log(`  Body size:       ${bytes.toLocaleString()} bytes`);
    console.log(`  Response time:   ${ms}ms`);

    // ─── Cache headers ──────────────────────────────────────────────────
    const etag = res.headers.get('etag');
    const lastMod = res.headers.get('last-modified');
    const cacheCtrl = res.headers.get('cache-control');

    console.log('\n' + bold('  Cache Headers'));
    console.log(`  ETag:            ${etag ? green(etag) : yellow('(none)')}`);
    console.log(`  Last-Modified:   ${lastMod ? green(lastMod) : yellow('(none)')}`);
    console.log(`  Cache-Control:   ${cacheCtrl || '(none)'}`);

    if (!etag && !lastMod) {
      console.log(yellow('\n  Note: No ETag or Last-Modified — the 304 caching scenario'));
      console.log(yellow('  may not apply to this URL. Validation will still run.'));
    }

    // ─── Edge / CDN headers ─────────────────────────────────────────────
    const optlyEdge = res.headers.get('x-optly-edge');
    const cfRay = res.headers.get('cf-ray');
    const xCache = res.headers.get('x-cache');
    const via = res.headers.get('via');
    const server = res.headers.get('server');

    console.log('\n' + bold('  Edge / CDN Headers'));
    console.log(`  x-optly-edge:    ${optlyEdge || '(none)'}`);
    console.log(`  cf-ray:          ${cfRay || '(none)'}`);
    console.log(`  x-cache:         ${xCache || '(none)'}`);
    console.log(`  via:             ${via || '(none)'}`);
    console.log(`  server:          ${server || '(none)'}`);

    // ─── HTML structure analysis ────────────────────────────────────────
    const hasDoctype = body.toLowerCase().includes('<!doctype');
    const hasHtml = body.includes('<html') || body.includes('<HTML');
    const hasHead = body.includes('<head') || body.includes('<HEAD');
    const hasBodyTag = body.includes('</body>') || body.includes('</BODY>');
    const titleMatch = body.match(/<title[^>]*>([^<]*)<\/title>/i);

    console.log('\n' + bold('  HTML Structure'));
    console.log(`  <!DOCTYPE>:      ${hasDoctype ? green('yes') : yellow('no')}`);
    console.log(`  <html> tag:      ${hasHtml ? green('yes') : red('NO')}`);
    console.log(`  <head> tag:      ${hasHead ? green('yes') : red('NO')}`);
    console.log(`  </body> tag:     ${hasBodyTag ? green('yes') : red('NO')}`);
    console.log(`  <title>:         ${titleMatch ? green(titleMatch[1].trim() || '(empty)') : yellow('(none)')}`);

    // ─── Marker candidates ──────────────────────────────────────────────
    const markerCandidates = [];
    const commonIds = ['app', 'root', '__next', '__nuxt', 'main', 'content', 'wrapper', 'page', 'site'];
    for (const id of commonIds) {
      if (body.includes(`id="${id}"`)) markerCandidates.push(`id="${id}"`);
    }
    const commonClasses = ['App', 'app', 'main-content', 'page-wrapper', 'site-wrapper'];
    for (const cls of commonClasses) {
      if (body.includes(`class="${cls}"`)) markerCandidates.push(`class="${cls}"`);
    }
    if (titleMatch && titleMatch[1].trim()) {
      markerCandidates.push(`<title>${titleMatch[1].trim()}`);
    }

    // ─── Recommendations ────────────────────────────────────────────────
    const recommendedMinBytes = Math.max(500, Math.floor(bytes * 0.4));

    console.log('\n' + bold('  Recommended Settings'));
    console.log(`  MIN_HTML_BYTES:  ${recommendedMinBytes} ${gray(`(40% of actual ${bytes.toLocaleString()} bytes)`)}`);
    if (markerCandidates.length) {
      console.log(`  HTML_MARKER:     ${green(markerCandidates[0])}`);
      if (markerCandidates.length > 1) {
        console.log(`  Other markers:   ${gray(markerCandidates.slice(1).join(', '))}`);
      }
    } else {
      console.log(`  HTML_MARKER:     ${yellow('(no common markers found — check body preview)')}`);
    }

    // ─── Body preview ───────────────────────────────────────────────────
    console.log('\n' + bold('  Body Preview (first 1000 chars)'));
    console.log(gray('  ──────────────────────────────────────────────────'));
    const lines = body.slice(0, 1000).split('\n');
    for (const line of lines) {
      console.log(gray('  ' + line.trimEnd()));
    }
    console.log(gray('  ──────────────────────────────────────────────────'));

    // ─── Return-visit simulation ────────────────────────────────────────
    if (etag || lastMod) {
      console.log('\n' + bold('  Return-Visit Simulation'));
      console.log(gray('  Sending conditional headers back to check for 304 behavior...'));

      const condHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
      };
      if (etag) condHeaders['If-None-Match'] = etag;
      if (lastMod) condHeaders['If-Modified-Since'] = lastMod;

      const start2 = Date.now();
      const res2 = await fetch(url, { headers: condHeaders, redirect: 'follow' });
      const body2 = await res2.text();
      const ms2 = Date.now() - start2;
      const bytes2 = Buffer.byteLength(body2, 'utf8');

      console.log(`  Status:          ${res2.status} ${res2.statusText}`);
      console.log(`  Body size:       ${bytes2.toLocaleString()} bytes`);
      console.log(`  Response time:   ${ms2}ms`);

      if (res2.status === 304) {
        console.log(yellow('\n  WARNING: 304 returned — conditional headers are NOT being stripped.'));
        console.log(yellow('  This is the exact scenario that causes blank pages.'));
        console.log(yellow('  Layer B (cache header stripping) may not be active for this URL.'));
      } else if (res2.status === 200 && bytes2 >= bytes * 0.8) {
        console.log(green('\n  OK: Full page returned despite conditional headers.'));
        console.log(green('  Edge is correctly stripping If-None-Match / If-Modified-Since.'));
      } else if (res2.status === 200 && bytes2 < bytes * 0.5) {
        console.log(yellow('\n  WARNING: 200 returned but page is significantly smaller.'));
        console.log(yellow(`  Original: ${bytes.toLocaleString()} bytes, Return: ${bytes2.toLocaleString()} bytes`));
        console.log(yellow('  Possible partial content — investigate.'));
      } else {
        console.log(gray(`\n  Status ${res2.status} with ${bytes2.toLocaleString()} bytes — review manually.`));
      }
    }

  } catch (err) {
    console.log(red(`\n  ERROR: ${err.message}`));
  }
}

console.log('');

})();
