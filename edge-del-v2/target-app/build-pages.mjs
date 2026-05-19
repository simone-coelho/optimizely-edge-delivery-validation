// Build pipeline for the integrated Pages deployment.
//
// Steps:
//   1. `nuxt build` with NITRO_PRESET=cloudflare_pages. This writes
//      dist/_worker.js/index.js (Nuxt's tiny re-export) plus
//      dist/_worker.js/chunks/nitro/nitro.mjs (the actual SSR handler).
//   2. esbuild bundles server/edge-entry.ts into dist/_worker.js/index.js,
//      replacing Nuxt's re-export. The bundle inlines:
//        - @optimizely/edge-delivery
//        - edge-del-v2-reinforce/companion-source (the 4 KB companion IIFE
//          as a string constant)
//      and externalizes:
//        - ./chunks/nitro/nitro.mjs (resolved at runtime by Cloudflare
//          against the file Nuxt already wrote alongside index.js)
//   3. Optional: write the build metadata to dist/_worker.js/build.json
//      so a curl can verify which build is deployed.
//
// Run with: `node build-pages.mjs` from target-app/, or via
// `npm run build` / `npm run deploy`.

import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
process.chdir(here);

// ── 1. Nuxt build (Cloudflare Pages preset) ─────────────────────────────
console.log('[build-pages] running nuxt build (preset=cloudflare_pages)');
const nuxt = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['nuxt', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, NITRO_PRESET: 'cloudflare_pages' }
});
if (nuxt.status !== 0) {
  console.error('[build-pages] nuxt build failed');
  process.exit(nuxt.status || 1);
}

const distWorkerDir = resolve(here, 'dist/_worker.js');
const nuxtEntry = resolve(distWorkerDir, 'index.js');
const nitroChunk = resolve(distWorkerDir, 'chunks/nitro/nitro.mjs');

if (!existsSync(nuxtEntry)) {
  console.error('[build-pages] dist/_worker.js/index.js not found after nuxt build');
  process.exit(1);
}
if (!existsSync(nitroChunk)) {
  console.error('[build-pages] dist/_worker.js/chunks/nitro/nitro.mjs not found after nuxt build');
  process.exit(1);
}

// ── 2. Stash Nuxt's tiny re-export aside (we don't need it; the nitro
//      chunk is what we actually import). Then bundle our edge-entry.ts
//      into a new index.js. ────────────────────────────────────────────
console.log('[build-pages] bundling edge-entry.ts -> dist/_worker.js/index.js');

const result = await build({
  entryPoints: [resolve(here, 'server/edge-entry.ts')],
  outfile: resolve(distWorkerDir, 'index.js'),
  bundle: true,
  format: 'esm',
  // 'neutral' is closest to Cloudflare Workers — no Node/browser globals
  // assumed. We have to spell out the module-resolution conditions and
  // package.json main fields ourselves.
  platform: 'neutral',
  conditions: ['worker', 'browser', 'import', 'module', 'default'],
  mainFields: ['module', 'main'],
  target: 'es2022',
  minify: false,
  sourcemap: false,
  nodePaths: [resolve(here, '../node_modules'), resolve(here, 'node_modules')],
  resolveExtensions: ['.ts', '.mjs', '.js', '.json'],
  external: [
    // Nuxt-emitted SSR handler — Cloudflare resolves this at runtime
    // against dist/_worker.js/chunks/nitro/nitro.mjs.
    './chunks/nitro/nitro.mjs',
    // Cloudflare runtime globals — never bundle these.
    'cloudflare:*',
    'node:*'
  ],
  allowOverwrite: true,
  logLevel: 'info'
});

if (result.errors && result.errors.length > 0) {
  console.error('[build-pages] esbuild reported errors');
  process.exit(1);
}

// ── 3. Write a small build manifest alongside so curl can confirm which
//      build is live. ──────────────────────────────────────────────────
const meta = {
  builtAt: new Date().toISOString(),
  edgeEntry: 'server/edge-entry.ts',
  nitroChunk: 'chunks/nitro/nitro.mjs',
  bundle: 'dist/_worker.js/index.js'
};
writeFileSync(resolve(distWorkerDir, 'build.json'), JSON.stringify(meta, null, 2));

console.log('[build-pages] done. dist ready to deploy:');
console.log('  npx wrangler pages deploy dist --project-name edge-del-v2-target --branch main --commit-dirty=true');
