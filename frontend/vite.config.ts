import {readFileSync} from 'node:fs'
import {fileURLToPath, URL} from 'node:url'
import vue from '@vitejs/plugin-vue'
import {defineConfig} from 'vite'

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8')) as {version: string}

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    // Firebase Hosting serves backend/public (see backend/firebase.json)
    outDir: '../backend/public',
    emptyOutDir: true,
  },
})
