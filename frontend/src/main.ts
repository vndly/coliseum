/**
 * Vue application entry point.
 * Creates the root App component, installs the router, and mounts it.
 */
import {createApp} from 'vue'
import App from '@/app.vue'
import router from '@/router'
import '@/assets/styles.css'

createApp(App).use(router).mount('#app')
