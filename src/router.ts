/**
 * Application routes.
 * History mode — the server must rewrite all paths to /index.html.
 */
import {createRouter, createWebHistory} from 'vue-router'
import HomeScreen from '@/components/screens/home_screen.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeScreen,
    },
  ],
})

export default router
