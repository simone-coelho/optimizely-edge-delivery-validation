<script setup lang="ts">
// UNKEYED v-for, intentional. Per the guidance, reordering unkeyed
// elements is one of the fragile cases — Vue's diff may treat reordered
// nodes as new and remount them. This component exists to exercise that
// boundary.
const props = defineProps<{ limit?: number }>()

const all = [
  { title: 'Edge cache',       blurb: 'Globally distributed caching for fast first-byte response.' },
  { title: 'CDN routing',      blurb: 'Smart routing based on request signals at the edge.' },
  { title: 'Experimentation',  blurb: 'Run A/B tests without flicker on above-the-fold content.' },
  { title: 'Hydration safe',   blurb: 'Built on Vue 3.5 with hydration mismatch tolerance.' },
  { title: 'Observability',    blurb: 'Real-time dashboards for every request.' },
  { title: 'Workers runtime',  blurb: 'Cloudflare Workers compute close to your users.' }
]

const features = props.limit ? all.slice(0, props.limit) : all
</script>

<template>
  <div class="cards" data-edge-region="feature-grid">
    <!-- intentional: no :key on v-for so reorder mismatch is exercisable -->
    <article
      v-for="feature in features"
      class="card"
      :data-feature-title="feature.title"
    >
      <h3>{{ feature.title }}</h3>
      <p>{{ feature.blurb }}</p>
    </article>
  </div>
</template>
