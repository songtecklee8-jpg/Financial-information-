import type { VercelRequest, VercelResponse } from '@vercel/node'

import { fetchEarningsCalendar } from './_lib/earnings.js'
import { loadKeys } from './_lib/env.js'
import { STORE_KEYS, TTL, readJson, writeJson } from './_lib/store.js'
import type { EarningsPayload } from './_lib/types.js'

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * GET / POST /api/earnings
 *
 * 返回未来 7 天美股财报日程（Finnhub / FMP）与马来西亚 Bursa (.KL) 最新季度财报公告。
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const keys = loadKeys()
  const body = (req.body ?? {}) as Record<string, unknown>

  const finnhubKey = str(body.finnhubKey) || keys.finnhub
  const fmpKey = str(body.fmpKey) || keys.fmp
  const geminiKey = str(body.geminiKey) || keys.gemini
  const aiRouting = str(body.aiRouting) || 'auto'
  const geminiModel = str(body.geminiModel)
  const refresh = str(req.query.refresh) === '1' || body.refresh === true

  const canUseCache = !refresh && !str(body.finnhubKey) && !str(body.fmpKey)
  if (canUseCache) {
    const cached = await readJson<EarningsPayload>(STORE_KEYS.earnings)
    if (cached) {
      res.status(200).json({ ok: true, cached: true, payload: cached })
      return
    }
  }

  const payload = await fetchEarningsCalendar({
    finnhubKey,
    fmpKey,
    geminiKey,
    aiRouting,
    geminiModel,
  })

  if (!str(body.finnhubKey) && !str(body.fmpKey)) {
    await writeJson(STORE_KEYS.earnings, payload, TTL.earnings)
  }

  res.status(200).json({ ok: true, cached: false, payload })
}
