<script setup lang="ts">
// A client-only island. Server renders a placeholder; the real content
// mounts after hydration. This exercises the guidance's note that
// "elements that do not exist in the initial HTML response" should not
// be targeted at the edge — the harness uses this region to prove that
// edge-applied edits against a client-only subtree never survive, and to
// validate that the reinforcement companion correctly applies post-mount.
import { ref, onMounted } from 'vue'

const mounted = ref(false)
const items = ref<{ id: string; title: string }[]>([])

onMounted(() => {
  mounted.value = true
  items.value = [
    { id: 'post-1', title: 'Why hydration mismatches happen' },
    { id: 'post-2', title: 'Edge experiments on Nuxt' },
    { id: 'post-3', title: 'Vue 3.5 and data-allow-mismatch' }
  ]
})
</script>

<template>
  <section data-edge-region="client-island">
    <h2 class="section-title" id="blog-island-title">Latest posts</h2>
    <ClientOnly>
      <div v-if="mounted" class="cards" id="blog-post-list">
        <article
          v-for="post in items"
          :key="post.id"
          class="card"
          :data-post-id="post.id"
        >
          <h3>{{ post.title }}</h3>
          <p>Mounted client-side. Edge edits against this region will not
            survive a hydration round-trip without reinforcement.</p>
        </article>
      </div>
      <template #fallback>
        <p id="blog-island-fallback">Loading posts…</p>
      </template>
    </ClientOnly>
  </section>
</template>
