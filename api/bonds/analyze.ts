import type { VercelRequest, VercelResponse } from '@vercel/node'

import { analyzeBondAuctions } from '../_lib/bonds.js'
import { loadKeys } from '../_lib/env.js'
import type { BondAuctionItem, BondMarketBenchmark } from '../_lib/types.js'

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * POST /api/bonds/analyze
 *
 * 调用 Gemini 多模型路由（Pro → Flash → Flash-Lite）研判 MGS / MGII 拍卖供需、收益率与汇率影响。
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const benchmarks = body.benchmarks as BondMarketBenchmark | undefined
  const auctions = Array.isArray(body.auctions) ? (body.auctions as BondAuctionItem[]) : []

  if (!benchmarks) {
    res.status(400).json({ ok: false, error: '缺少 benchmarks 参数' })
    return
  }

  const keys = loadKeys()
  const geminiKey = str(body.geminiKey) || keys.gemini
  const aiRouting = str(body.aiRouting) || 'auto'
  const geminiModel = str(body.geminiModel)

  const analysis = await analyzeBondAuctions(benchmarks, auctions, {
    geminiKey,
    aiRouting,
    geminiModel,
  })

  res.status(200).json({ ok: true, analysis })
}
