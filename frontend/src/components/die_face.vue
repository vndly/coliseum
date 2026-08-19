<!-- A die face, carrying the same pip layout as the dice in the bowl.

     The game counts in dice, so the interface does too: a match's size is
     chosen as a face, and a seat is shown as a face. Decorative on its own —
     whatever it stands for is named in text beside it or on the control that
     wraps it. -->
<script setup lang="ts">
import {computed} from 'vue'

const props = withDefaults(defineProps<{
  value: number
  lit?: boolean
}>(), {
  lit: false,
})

/**
 * Which cells of a three by three grid carry a pip, numbered left to right and
 * top to bottom. Built the way the real die builds its own rather than listed
 * out: an odd face carries a centre pip, and the rest are opposing pairs added
 * two at a time.
 */
const cells = computed<number[]>(() => {
  const pips: number[] = []

  if (props.value % 2 === 1) {
    pips.push(5)
  }

  if (props.value >= 2) {
    pips.push(7, 3)
  }

  if (props.value >= 4) {
    pips.push(1, 9)
  }

  if (props.value >= 6) {
    pips.push(4, 6)
  }

  return pips
})
</script>

<template>
  <span class="die-face" :class="{'die-face--lit': lit}" aria-hidden="true">
    <span
      v-for="cell in 9"
      :key="cell"
      class="die-face__pip"
      :class="{'die-face__pip--on': cells.includes(cell)}"
    />
  </span>
</template>

<style scoped>
.die-face {
    --size: 2rem;

    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
    width: var(--size);
    height: var(--size);

    /* Both taken from the die's own size rather than written as percentages.
       A percentage padding resolves against the parent's width, not the
       element's, so the same die swelled to fill whatever it was set inside —
       right in a button cut to its size, enormous in a list row. */
    gap: calc(var(--size) * 0.12);
    padding: calc(var(--size) * 0.14);

    /* The same proportion of its own width that the real die is rounded by */
    border-radius: 18%;
    border: 1px solid var(--brass-edge);
    background: var(--well);
    transition: background 160ms ease, border-color 160ms ease;
}

/* Lit reads as a die pulled out of the bowl and set down: bone, with the pips
   actually cut into it, rather than the dark blank of an unfilled seat */
.die-face--lit {
    border-color: var(--bone);
    background: var(--bone);
}

.die-face__pip {
    border-radius: 50%;
    background: transparent;
}

.die-face__pip--on {
    background: var(--brass-edge);
}

.die-face--lit .die-face__pip--on {
    background: var(--pip);
}
</style>
