// Injects two things before </body>:
//   1. An inline JSON variation manifest the companion script reads.
//   2. The companion script source, inlined (so no extra HTTP request).
//
// The companion source is imported as a string from the reinforce package's
// build output. See reinforce/build.mjs for how that string is produced.
import { COMPANION_SOURCE } from 'edge-del-v2-reinforce/companion-source';
import type { VariationManifest } from '../types';

const MANIFEST_TAG_ID = 'edge-del-v2-manifest';
const COMPANION_TAG_ID = 'edge-del-v2-companion';

export function inject(response: Response, manifest: VariationManifest): Response {
  const manifestJson = JSON.stringify(manifest)
    // Avoid </script> injection inside the JSON payload.
    .replace(/<\/script/gi, '<\\/script');

  return new HTMLRewriter()
    .on('body', {
      element(body) {
        body.append(
          `<script type="application/json" id="${MANIFEST_TAG_ID}">${manifestJson}</script>`,
          { html: true }
        );
        body.append(
          `<script id="${COMPANION_TAG_ID}">${COMPANION_SOURCE}</script>`,
          { html: true }
        );
      }
    })
    .transform(response);
}
