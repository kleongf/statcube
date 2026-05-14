import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/ftcscout-graphql': {
        target: 'https://api.ftcscout.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ftcscout-graphql/, '/graphql'),
      },
    },
  },
})
