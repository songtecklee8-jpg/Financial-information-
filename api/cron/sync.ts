import type { VercelRequest, VercelResponse } from '@vercel/node'

import { enrichArticles } from '../_lib/ai.js'
import { fetchBondsTracker } from '../_lib/bonds.js'
import { fetchEarningsCalendar } from '../_lib/earnings.js'
import { loadKeys, loadWatchlist } from '../_lib/env.js'
import { fetchAllNews } from '../_lib/news.js'
import { fetchQuotes } from '../_lib/quotes.js'
import { STORE_KEYS, TTL, readJson, usingUpstash, writeJson } from '../_lib/store.js'
import type { NewsPayload, QuotesPayload, SyncMeta } from '../_lib/types.js'

/**
 * POST / GET /api/cron/sync
 *
 * 后台 24 小时静默同步入口（Vercel Cron 与外部定时服务共用）：
 * 1. 多引擎拉取自选池美股 / 马股 .KL / 加密资产最新行情
 * 2. 抓取全部在线新闻源
 * 3. 对新抓到的新闻用 gemini-2.5-flash-lite 预翻译标题、生成一句话摘要与多空标签
 * 4. 全部写入 Upstash Redis（本地开发降级为内存 / 临时文件）
 *
 * 安全：配置了 CRON_SECRET 后，必须携带 Authorization: Bearer <CRON_SECRET>
 * 或查询参数 ?key=<CRON_SECRET>。
 */

/** 每轮后台同步最多为新新闻消耗的 AI 条数（控制配额与耗时） */
const MAX_ENRICH_PER_RUN = 40

function extractSecret(req: VercelRequest): string {
  const header = req.headers['authorization'] ?? ''
  const bearer = Array.isArray(header) ? header[0] : header
  if (bearer && bearer.toLowerCase().startsWith('bearer ')) return bearer.slice(7).trim()
  const custom = req.headers['x-cron-secret']
  const customValue = Array.isArray(custom) ? custom[0] : custom
  if (customValue) return customValue.trim()
  const query = req.query.key
  if (typeof query === 'string') return query.trim()
  return ''
}

function authorize(req: VercelRequest, secret: string): boolean {
  // 未配置 CRON_SECRET（本地开发）时直接放行
  if (!secret) return true
  return extractSecret(req) === secret
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const started = Date.now()
  const keys = loadKeys()

  if (!authorize(req, keys.cronSecret)) {
    res.status(401).json({ ok: false, error: 'unauthorized：CRON_SECRET 校验失败' })
    return
  }

  const errors: string[] = []
  const trigger: SyncMeta['trigger'] = req.headers['x-vercel-cron'] ? 'cron' : 'external'

  // ------------------------------------------------------------------ 行情
  let quotes: Record<string, QuotesPayload['quotes'][string]> = {}
  try {
    quotes = await fetchQuotes(loadWatchlist(), keys)
  } catch (error) {
    errors.push(`行情同步失败：${error instanceof Error ? error.message : String(error)}`)
  }
  const quotesPayload: QuotesPayload = {
    quotes,
    updatedAt: new Date().toISOString(),
    liveCount: Object.keys(quotes).length,
  }

  // ------------------------------------------------------------------ 新闻
  let newsTotal = 0
  let newsTranslated = 0
  let newsModel: string | undefined
  try {
    const fetched = await fetchAllNews(keys)
    const existing = await readJson<NewsPayload>(STORE_KEYS.news)
    const known = new Set((existing?.articles ?? []).map((item) => item.id))

    // 仅对「新抓到」的英文新闻做后台预翻译，避免重复消耗 API 额度
    const fresh = fetched.filter((item) => !known.has(item.id))
    const pending = fresh.filter((item) => item.lang === 'en').slice(0, MAX_ENRICH_PER_RUN)
    const enriched = await enrichArticles(pending, keys.gemini)
    newsModel = enriched.model ?? existing?.model

    // 合并：新抓到的 + 仍在有效期内的历史条目（保留其既有翻译）
    const merged = [
      ...fetched,
      ...(existing?.articles ?? []).filter((item) => !fetched.some((next) => next.id === item.id)),
    ]
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, 150)

    const newsPayload: NewsPayload = {
      articles: merged,
      updatedAt: new Date().toISOString(),
      model: newsModel,
      translatedCount: merged.filter((item) => item.translation === 'done').length,
    }
    newsTotal = merged.length
    newsTranslated = newsPayload.translatedCount
    await writeJson(STORE_KEYS.news, newsPayload, TTL.news)
  } catch (error) {
    errors.push(`新闻同步失败：${error instanceof Error ? error.message : String(error)}`)
  }

  // ------------------------------------------------------------------ 财报日历与国债
  try {
    const earningsPayload = await fetchEarningsCalendar({
      finnhubKey: keys.finnhub,
      fmpKey: keys.fmp,
      geminiKey: keys.gemini,
      aiRouting: 'auto',
    })
    await writeJson(STORE_KEYS.earnings, earningsPayload, TTL.earnings)
  } catch (error) {
    errors.push(`财报日历同步失败：${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const bondsPayload = await fetchBondsTracker({
      geminiKey: keys.gemini,
      aiRouting: 'auto',
    })
    await writeJson(STORE_KEYS.bonds, bondsPayload, TTL.bonds)
  } catch (error) {
    errors.push(`国债日历同步失败：${error instanceof Error ? error.message : String(error)}`)
  }

  // ------------------------------------------------------------------ 落库
  await writeJson(STORE_KEYS.quotes, quotesPayload, TTL.quotes)

  const meta: SyncMeta = {
    lastSyncAt: new Date().toISOString(),
    lastSyncDurationMs: Date.now() - started,
    trigger,
    quotes: { total: Object.keys(quotes).length, live: quotesPayload.liveCount },
    news: { total: newsTotal, translated: newsTranslated },
    errors,
    usingUpstash: usingUpstash(),
  }
  await writeJson(STORE_KEYS.syncMeta, meta, TTL.news)

  res.status(200).json({ ok: true, ...meta })
}
