<script setup lang="ts">
// Keyed v-for. Per the guidance, Vue handles reordering of keyed elements
// gracefully — this exercise lets the harness prove that the
// rearrange-keyed case hydrates without recovery.
interface Plan {
  id: string
  name: string
  price: string
  blurb: string
}

const plans: Plan[] = [
  { id: 'starter',      name: 'Starter',      price: '$0',   blurb: 'For individual developers and small teams.' },
  { id: 'professional', name: 'Professional', price: '$29',  blurb: 'For growing teams that need collaboration.' },
  { id: 'enterprise',   name: 'Enterprise',   price: 'Talk', blurb: 'For organizations with security and SLA needs.' }
]
</script>

<template>
  <div class="cards" data-edge-region="pricing-cards">
    <article
      v-for="plan in plans"
      :key="plan.id"
      class="card"
      :data-plan-id="plan.id"
      :id="`plan-${plan.id}`"
    >
      <h3>{{ plan.name }}</h3>
      <p class="price" :id="`price-${plan.id}`">{{ plan.price }}</p>
      <p>{{ plan.blurb }}</p>
    </article>
  </div>
</template>
