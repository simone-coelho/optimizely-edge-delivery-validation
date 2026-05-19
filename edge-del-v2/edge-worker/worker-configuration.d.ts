// Ambient global Env type. `wrangler types` regenerates this in real
// projects; here we declare it by hand so tsc picks it up without an
// extra wrangler dev cycle.
//
// Keep keys in sync with wrangler.toml [env.*.vars].
export {};

declare global {
  interface Env {
    MODE: 'local' | 'sdk';
    PAGES_ORIGIN: string;
    DEBUG: string;
    LAB_BUILD: string;
    SNIPPET_ID: string;
    EDGE_ENV: 'dev' | 'prod';
  }
}
