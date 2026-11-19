import type { VercelRequest, VercelResponse } from '@vercel/node'

import { buildBursaEarningsDetail } from '../_lib/earnings.js'
import { loadKeys } from '../_lib/env.js'
import { STORE_KEYS, TTL, readJson, writeJson } from '../_lib/store.js'
import type { BursaAnnouncement, BursaEarningsDetail } from '../_lib/types.js'

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * POST /api/earnings/detail
 *
 * 解析单份大马交易所（Bursa .KL）季度财报与 PDF 摘要，遵循多模型自动降级机制。
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const announcement = body.announcement as BursaAnnouncement | undefined
  if (!announcement || !announcement.id) {
    res.status(400).json({ ok: false, error: '缺少 announcement 参数' })
    return
  }

  const keys = loadKeys()
  const geminiKey = str(body.geminiKey) || keys.gemini
  const aiRouting = str(body.aiRouting) || 'auto'
  const geminiModel = str(body.geminiModel)
  const refresh = body.refresh === true

  const cacheKey = STORE_KEYS.earningsDetail(`${announcement.id}:${aiRouting}:${geminiModel || 'default'}`)
  if (!refresh) {
    const cached = await readJson<BursaEarningsDetail>(cacheKey)
    if (cached && !cached.degraded) {
      res.status(200).json({ ok: true, cached: true, detail: cached })
      return
    }
  }

  const detail = await buildBursaEarningsDetail(announcement, {
    geminiKey,
    aiRouting,
    geminiModel,
  })

  if (!detail.degraded) {
    await writeJson(cacheKey, detail, TTL.detail)
  }

  res.status(200).json({ ok: true, cached: false, detail })
}
