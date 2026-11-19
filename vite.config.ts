import type { IncomingMessage } from 'node:http'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const API_ROUTES: Record<string, string> = {
  '/api/snapshot': '/api/snapshot.ts',
  '/api/news/detail': '/api/news/detail.ts',
  '/api/cron/sync': '/api/cron/sync.ts',
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function localApiPlugin(): Plugin {
  return {
    name: 'local-api-routes',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? '/'
        const parsedUrl = new URL(rawUrl, 'http://localhost')
        const entry = API_ROUTES[parsedUrl.pathname]
        if (!entry) {
          next()
          return
        }

        try {
          const mod = (await server.ssrLoadModule(entry)) as {
            default?: (request: unknown, response: unknown) => Promise<void> | void
          }
          if (typeof mod.default !== 'function') {
            next()
            return
          }

          const query: Record<string, string | string[]> = {}
          for (const [key, value] of parsedUrl.searchParams.entries()) {
            const existing = query[key]
            if (existing === undefined) query[key] = value
            else if (Array.isArray(existing)) existing.push(value)
            else query[key] = [existing, value]
          }

          const body =
            req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH'
              ? await readBody(req)
              : {}

          const vercelReq = {
            method: req.method,
            url: rawUrl,
            headers: req.headers,
            query,
            body,
          }

          let statusCode = 200
          const vercelRes = {
            setHeader(name: string, value: string | number | readonly string[]) {
              res.setHeader(name, value)
              return vercelRes
            },
            status(code: number) {
              statusCode = code
              return vercelRes
            },
            json(payload: unknown) {
              if (!res.headersSent) {
                res.statusCode = statusCode
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
              }
              res.end(JSON.stringify(payload))
              return vercelRes
            },
            send(payload: unknown) {
              if (!res.headersSent) {
                res.statusCode = statusCode
              }
              res.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
              return vercelRes
            },
          }

          await mod.default(vercelReq, vercelRes)
          if (!res.writableEnded) res.end()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
          }
          res.end(JSON.stringify({ ok: false, error: message }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), localApiPlugin()],
  // 相对路径产物：适配 GitHub Pages 项目站点（/repo/ 子路径）等任意部署位置
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // 允许通过反向隧道（serveo 等）以公网域名访问，避免 Vite 的 Host 校验拦截
  server: { host: '0.0.0.0', port: 3000, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 3000, allowedHosts: true },
})
