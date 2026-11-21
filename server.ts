import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { VercelRequest, VercelResponse } from '@vercel/node'
import express, { type Request, type Response } from 'express'

import aiCompleteHandler from './api/ai/complete.js'
import bondsHandler from './api/bonds.js'
import bondsAnalyzeHandler from './api/bonds/analyze.js'
import cronSyncHandler from './api/cron/sync.js'
import earningsHandler from './api/earnings.js'
import earningsDetailHandler from './api/earnings/detail.js'
import newsDetailHandler from './api/news/detail.js'
import newsSearchHandler from './api/news/search.js'
import snapshotHandler from './api/snapshot.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000
const HOST = '0.0.0.0'

type VercelHandler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void

function adapt(handler: VercelHandler) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await handler(req as unknown as VercelRequest, res as unknown as VercelResponse)
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          error: error instanceof Error ? error.message : 'Internal server error',
        })
      }
    }
  }
}

async function startServer() {
  const app = express()
  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: true }))

  app.all('/api/snapshot', adapt(snapshotHandler))
  app.all('/api/news/detail', adapt(newsDetailHandler))
  app.all('/api/news/search', adapt(newsSearchHandler))
  app.all('/api/cron/sync', adapt(cronSyncHandler))
  app.all('/api/earnings', adapt(earningsHandler))
  app.all('/api/earnings/detail', adapt(earningsDetailHandler))
  app.all('/api/bonds', adapt(bondsHandler))
  app.all('/api/bonds/analyze', adapt(bondsAnalyzeHandler))
  app.all('/api/ai/complete', adapt(aiCompleteHandler))

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist')
    app.use(express.static(distDir))
    app.use((_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'))
    })
  } else {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  }

  app.listen(PORT, HOST, () => {
    console.log(`APEX Terminal listening on http://${HOST}:${PORT}`)
  })
}

void startServer()
