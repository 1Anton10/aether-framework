<script>
  // Svelte — counter + #each → ControlFlow::Loop
</script>

<div>
  <h1>{count}</h1>
  <button on:click={inc_count}>+</button>
  <ul>
    {#each items as item}
      <li class="row">row</li>
    {/each}
  </ul>
</div>
