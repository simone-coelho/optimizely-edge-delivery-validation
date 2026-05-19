// Nuxt 3.21 / Vue 3.5.x
// SSR enabled so we exercise hydration; Cloudflare Pages preset so the build
// output deploys directly to Pages and the SDK can fetch from <project>.pages.dev.
export default defineNuxtConfig({
  ssr: true,
  compatibilityDate: '2026-05-01',
  nitro: {
    preset: 'cloudflare_pages',
    prerender: {
      // Pre-render nothing by default — every request goes through SSR so the
      // edge worker always gets a fresh server-rendered response and the
      // hydration boundary is exercised on every visit.
      crawlLinks: false
    }
  },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'edge-del-v2-fixture', content: 'hydration-lab' }
      ]
    }
  },
  css: ['~/assets/main.css'],
  // Surface the build through a stable id so the worker can detect this
  // target app vs anything else routed through it.
  runtimeConfig: {
    public: {
      labFixtureId: 'edge-del-v2-target'
    }
  }
})
