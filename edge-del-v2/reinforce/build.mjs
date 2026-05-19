// Bundle the companion script and emit:
//   dist/companion.min.js          — raw minified IIFE (for debugging)
//   dist/companion-source.mjs      — ESM module exporting COMPANION_SOURCE
//                                    as a string constant. The worker
//                                    imports this and inlines the source
//                                    via HTMLRewriter so no extra HTTP
//                                    request is needed.
//   dist/index.mjs                 — re-exports shared types
//
// Run with: `npm run build --workspace edge-del-v2-reinforce` from the
// kit root, or `node build.mjs` from this directory.

import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, 'dist');
mkdirSync(distDir, { recursive: true });

// 1. Bundle the companion (browser, IIFE, minified).
const companion = await build({
  entryPoints: [resolve(here, 'src/companion.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  write: false,
  legalComments: 'none',
  treeShaking: true
});

const companionSource = companion.outputFiles[0].text;
writeFileSync(resolve(distDir, 'companion.min.js'), companionSource);
writeFileSync(
  resolve(distDir, 'companion-source.mjs'),
  `// Auto-generated. Do not edit by hand. See ../build.mjs.\nexport const COMPANION_SOURCE = ${JSON.stringify(companionSource)};\n`
);
writeFileSync(
  resolve(distDir, 'companion-source.d.ts'),
  `export declare const COMPANION_SOURCE: string;\n`
);

// 2. Public entry — re-export shared types.
await build({
  entryPoints: [resolve(here, 'src/index.ts')],
  bundle: false,
  format: 'esm',
  target: ['es2020'],
  outfile: resolve(distDir, 'index.mjs')
});

writeFileSync(
  resolve(distDir, 'index.d.ts'),
  `export type { Op, OpType, VariationManifest, Case } from '../src/types';\n`
);

console.log(`reinforce: companion bundle ${(companionSource.length / 1024).toFixed(2)} KB`);
console.log(`reinforce: wrote ${distDir}`);
