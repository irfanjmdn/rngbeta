import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'node:path'
import fs from 'node:fs'

function impeccableLivePlugin() {
  return {
    name: 'impeccable-live-serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ? req.url.split('?')[0] : ''
        if (rawUrl.includes('.impeccable-live')) {
          const rel = rawUrl.replace(/^\//, '').replace(/^node_modules\//, '')
          const absPath = path.resolve(__dirname, '../node_modules', rel)
          if (rawUrl.endsWith('.json')) {
            if (fs.existsSync(absPath)) {
              res.setHeader('Content-Type', 'application/json')
              res.statusCode = 200
              res.end(fs.readFileSync(absPath, 'utf-8'))
              return
            }
          }
          if (rawUrl.endsWith('.svelte')) {
            try {
              const result = await server.transformRequest(absPath)
              if (result) {
                res.setHeader('Content-Type', 'application/javascript')
                res.statusCode = 200
                res.end(result.code)
                return
              }
            } catch (err) {
              console.error('[impeccable-live-serve] compile error:', err)
            }
          }
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    impeccableLivePlugin(),
    svelte({
      include: [/\.svelte$/],
    }),
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/sounds': 'http://127.0.0.1:8080',
    },
  },
})
