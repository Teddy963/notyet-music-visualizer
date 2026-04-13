import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // Local dev: /api/mood → Anthropic (key injected server-side via vite proxy)
      '/api/mood': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: () => '/v1/messages',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const key = process.env.ANTHROPIC_KEY
            if (key) proxyReq.setHeader('x-api-key', key)
            proxyReq.removeHeader('x-user-api-key')
          })
        },
      },
    },
  },
})
