/**
 * Application routes.
 * History mode — the server must rewrite all paths to /index.html.
 */
import {createRouter, createWebHistory} from 'vue-router'
import LobbyScreen from '@/components/screens/lobby_screen.vue'
import MatchScreen from '@/components/screens/match_screen.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: LobbyScreen,
    },
    {
      // The code is the match document's own name, so this address is both the
      // route and the thing a player reads out to whoever is joining
      path: '/match/:code',
      name: 'match',
      component: MatchScreen,
    },
  ],
})

export default router
