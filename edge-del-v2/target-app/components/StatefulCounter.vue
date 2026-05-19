<script setup lang="ts">
// A stateful child component. Per the guidance, "any change to a subtree
// containing stateful child components" is among the most fragile edge-
// applied cases because each component carries its own hydration
// expectations. This component is the harness target for case 07.
import { ref, computed } from 'vue'

defineProps<{ id?: string }>()

const count = ref(0)
const label = computed(() => `${count.value} click${count.value === 1 ? '' : 's'}`)

function increment() {
  count.value += 1
}
</script>

<template>
  <div
    class="card"
    :data-counter-id="$attrs.id || 'counter'"
    data-edge-region="stateful-counter"
  >
    <h3 id="counter-headline">Stateful counter</h3>
    <p id="counter-label">{{ label }}</p>
    <button id="counter-button" class="cta" type="button" @click="increment">
      Bump count
    </button>
  </div>
</template>
