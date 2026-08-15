<!-- The application's only screen. Holds the 3D dice bowl and nothing else. -->
<script setup lang="ts">
import {onBeforeUnmount, onMounted, useTemplateRef} from 'vue'
import {DishScene} from '@/scene/dish_scene'

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')

// Not a ref: the scene mutates every frame and must stay out of reactivity
let scene: DishScene | null = null

onMounted(() => {
  const element = canvas.value

  if (!element) {
    return
  }

  scene = new DishScene(element)
  scene.start()
})

onBeforeUnmount(() => {
  scene?.dispose()
  scene = null
})
</script>

<template>
  <main class="home-screen">
    <!-- The right button orbits the camera, so the browser's own menu on that
         button has to stay out of the way -->
    <canvas
      ref="canvas"
      class="home-screen__canvas"
      @contextmenu.prevent
    />
  </main>
</template>

<style scoped>
.home-screen {
    height: 100%;
}

.home-screen__canvas {
    display: block;
    width: 100%;
    height: 100%;

    /* Matches BACKGROUND_COLOR in dimensions.ts, so the first frame does not
       arrive over a white page */
    background: #0e1210;

    /* Lets the controls handle drags on touch instead of the page scrolling */
    touch-action: none;
}
</style>
