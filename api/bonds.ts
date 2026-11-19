import type { VercelRequest, VercelResponse } from '@vercel/node'

import { fetchBondsTracker } from './_lib/bonds.js'
import { loadKeys } from './_lib/env.js'
import { STORE_KEYS, TTL, readJson, writeJson } from './_lib/store.js'
import type { BondsPayload } from './_lib/types.js'

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * GET / POST /api/bonds
 *
 * 马来西亚政府债券（MGS / MGII）拍卖日历与 BNM OPR / 收益率基准追踪。
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const keys = loadKeys()
  const body = (req.body ?? {}) as Record<string, unknown>
  const geminiKey = str(body.geminiKey) || keys.gemini
  const aiRouting = str(body.aiRouting) || 'auto'
  const geminiModel = str(body.geminiModel)
  const refresh = str(req.query.refresh) === '1' || body.refresh === true

  if (!refresh) {
    const cached = await readJson<BondsPayload>(STORE_KEYS.bonds)
    if (cached) {
      res.status(200).json({ ok: true, cached: true, payload: cached })
      return
    }
  }

  const payload = await fetchBondsTracker({
    geminiKey,
    aiRouting,
    geminiModel,
  })

  await writeJson(STORE_KEYS.bonds, payload, TTL.bonds)
  res.status(200).json({ ok: true, cached: false, payload })
}
