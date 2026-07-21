<template>
  <div>
    <h1>{{ count }}</h1>
    <button @click="inc_count">+</button>
    <ul>
      <li v-for="item in items" class="row">row</li>
    </ul>
  </div>
</template>

<script setup>
// Vue SFC — counter + v-for → ControlFlow::Loop
</script>
