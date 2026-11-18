import type { VercelRequest, VercelResponse } from '@vercel/node'

import { STORE_KEYS, readJson } from './_lib/store.js'
import type { NewsPayload, QuotesPayload, SyncMeta } from './_lib/types.js'

/**
 * GET /api/snapshot
 *
 * 首屏毫秒级读取端点：直接返回后台已准备好的最新行情快照与新闻列表，
 * 前端打开网页无需等待任何外部 API 转圈。
 */
export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  const [quotes, news, meta] = await Promise.all([
    readJson<QuotesPayload>(STORE_KEYS.quotes),
    readJson<NewsPayload>(STORE_KEYS.news),
    readJson<SyncMeta>(STORE_KEYS.syncMeta),
  ])

  const ready = Boolean(quotes && news)

  // 允许 CDN 边缘缓存 60s，并在后台并行刷新，进一步压低首屏延迟
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  res.status(200).json({
    ok: ready,
    ready,
    quotes: quotes ?? null,
    news: news ?? null,
    meta: meta ?? null,
  })
}
