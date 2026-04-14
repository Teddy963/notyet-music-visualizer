import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
    plugins: [
      {
        name: 'local-mood-api',
        configureServer(server) {
          server.middlewares.use('/api/mood', async (req, res) => {
            const key = env.ANTHROPIC_KEY
            if (!key) { res.statusCode = 401; res.end('No API key'); return }

            const chunks = []
            req.on('data', c => chunks.push(c))
            req.on('end', async () => {
              try {
                const body = Buffer.concat(chunks).toString()
                const upstream = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                    'x-api-key': key,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                  },
                  body,
                })
                const data = await upstream.text()
                res.statusCode = upstream.status
                res.setHeader('content-type', 'application/json')
                res.end(data)
              } catch (e) {
                console.error('[mood-proxy] error:', e.message)
                res.statusCode = 500; res.end(JSON.stringify({ error: e.message }))
              }
            })
          })
        },
      },
    ],
  }
})
