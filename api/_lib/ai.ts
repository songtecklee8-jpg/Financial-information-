/**
 * APEX Terminal — 后台 AI 增强流程。
 *
 * - enrichArticles：批量标题翻译 + 一句话摘要 + 多空标签（gemini-2.5-flash-lite）
 * - buildNewsDetail：单篇核心摘要要点 + 五大资产推演 + 全文整篇翻译（gemini-2.5-flash）
 */

import {
  SERVER_FLASH_MODEL,
  SERVER_LITE_MODEL,
  generateServer,
  parseJsonLoose,
} from './geminiServer.js'
import {
  BATCH_INSTRUCTION,
  BATCH_SCHEMA,
  DETAIL_INSTRUCTION,
  DETAIL_SCHEMA,
  SERVER_RESEARCH_DOCTRINE,
  TRANSLATE_FULL_INSTRUCTION,
} from './prompts.js'
import type {
  AssetImpact,
  AssetKey,
  ImpactDirection,
  NewsDetail,
  NewsImpact,
  ServerArticle,
} from './types.js'

// ---------------------------------------------------------------------------
// 批量翻译 / 摘要 / 情绪标签
// ---------------------------------------------------------------------------

interface BatchItem {
  id: string
  titleZh: string
  summaryZh: string
  sentiment: 'bullish' | 'bearish' | 'neutral'
}

const BATCH_SIZE = 20

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function normalizeSentiment(value: unknown): 'bullish' | 'bearish' | 'neutral' {
  return value === 'bullish' || value === 'bearish' || value === 'neutral' ? value : 'neutral'
}

/**
 * 对英文新闻批量执行华文翻译 + 摘要 + 情绪标签，直接原地补全到文章对象。
 * 返回实际命中的模型与完成翻译的条数。
 */
export async function enrichArticles(
  articles: ServerArticle[],
  apiKey: string,
): Promise<{ model: string | null; translatedCount: number }> {
  const pending = articles.filter((item) => item.lang === 'en')
  if (!apiKey || pending.length === 0) {
    return { model: null, translatedCount: articles.filter((a) => a.translation === 'done').length }
  }

  let model: string | null = null

  for (const group of chunk(pending, BATCH_SIZE)) {
    const payload = group.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary.slice(0, 400),
    }))
    try {
      const result = await generateServer({
        apiKey,
        model: SERVER_LITE_MODEL,
        system: `${SERVER_RESEARCH_DOCTRINE}\n\n${BATCH_INSTRUCTION}`,
        prompt: JSON.stringify(payload),
        temperature: 0.2,
        maxOutputTokens: 4096,
        responseSchema: BATCH_SCHEMA,
      })
      model = result.model
      const parsed = parseJsonLoose<{ items?: BatchItem[] }>(result.text)
      const index = new Map(group.map((item) => [item.id, item]))
      for (const row of parsed?.items ?? []) {
        const target = index.get(row.id)
        if (!target) continue
        if (row.titleZh) target.titleZh = row.titleZh.trim()
        if (row.summaryZh) target.summaryZh = row.summaryZh.trim()
        target.sentiment = normalizeSentiment(row.sentiment)
        target.translation = 'done'
      }
    } catch {
      // 该批次失败：保留原文，继续下一批
    }
  }

  return {
    model,
    translatedCount: articles.filter((a) => a.translation === 'done').length,
  }
}

// ---------------------------------------------------------------------------
// 单篇详情：摘要要点 + 五大资产推演 + 全文翻译
// ---------------------------------------------------------------------------

const ASSET_LABELS: Record<AssetKey, string> = {
  equities: '股票',
  bonds: '债券',
  realEstate: '房地产',
  gold: '黄金',
  volatility: '期权',
}

const ASSET_ORDER: AssetKey[] = ['equities', 'bonds', 'realEstate', 'gold', 'volatility']

const ASSET_KEYS = new Set<string>(ASSET_ORDER)

function clampPct(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

function normalizeDirection(value: unknown, up: number): ImpactDirection {
  if (value === 'bullish' || value === 'bearish' || value === 'neutral') return value
  if (up >= 58) return 'bullish'
  if (up <= 42) return 'bearish'
  return 'neutral'
}

/** 把模型返回的资产数组规范为固定五类，且 up + down = 100 */
function normalizeAssets(raw: unknown): AssetImpact[] {
  const byKey = new Map<AssetKey, AssetImpact>()
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
      const key = String(row.asset ?? '')
      if (!ASSET_KEYS.has(key)) continue
      const up = clampPct(row.up, 50)
      const down = 100 - up
      byKey.set(key as AssetKey, {
        asset: key as AssetKey,
        label: String(row.label ?? ASSET_LABELS[key as AssetKey]),
        up,
        down,
        direction: normalizeDirection(row.direction, up),
        driver: String(row.driver ?? ''),
        detail: String(row.detail ?? ''),
      })
    }
  }
  return ASSET_ORDER.map(
    (key) =>
      byKey.get(key) ?? {
        asset: key,
        label: ASSET_LABELS[key],
        up: 50,
        down: 50,
        direction: 'neutral' as ImpactDirection,
        driver: '中性情景，暂无明显方向性驱动。',
        detail: '',
      },
  )
}

export interface BuildDetailInput {
  article: ServerArticle
  /** 抓取清洗后的全文（为空则回落到 RSS 导语） */
  fullText: string
  apiKey: string
  /** 可选模型覆盖（用于支持 Pro / Flash / Lite 路由模式） */
  model?: string
}

/** 生成单篇新闻的深度详情（摘要要点 + 推演 + 全文翻译） */
export async function buildNewsDetail(input: BuildDetailInput): Promise<NewsDetail> {
  const { article, fullText, apiKey } = input
  const body = (fullText || article.summary || article.title).slice(0, 14_000)
  const now = new Date().toISOString()

  const fallbackImpact: NewsImpact = {
    articleId: article.id,
    headline: article.titleZh ?? article.title,
    eventBreakdown: article.summaryZh ?? article.summary,
    transmission: '暂未获得 AI 推演结果。',
    liquidity: '',
    rateExpectation: '',
    sectorImpact: '',
    assets: normalizeAssets([]),
    watchlist: article.tickers,
    confidence: 0,
    generatedAt: now,
    model: 'local',
    degraded: true,
  }

  if (!apiKey) {
    return {
      id: article.id,
      url: article.url,
      title: article.title,
      titleZh: article.titleZh,
      sourceName: article.sourceName,
      publishedAt: article.publishedAt,
      summaryPoints: [],
      fullText,
      fullTextZh: article.lang === 'zh' ? fullText : '',
      impact: fallbackImpact,
      model: 'local',
      extraction: fullText ? 'fallback' : 'unavailable',
      cachedAt: now,
    }
  }

  const targetModel = input.model || SERVER_FLASH_MODEL

  const detailResult = await generateServer({
    apiKey,
    model: targetModel,
    system: `${SERVER_RESEARCH_DOCTRINE}\n\n${DETAIL_INSTRUCTION}`,
    prompt: `新闻来源：${article.sourceName}\n发布时间：${article.publishedAt}\n标题：${article.title}\n导语：${article.summary}\n\n全文：\n${body}`,
    temperature: 0.35,
    maxOutputTokens: 8192,
    responseSchema: DETAIL_SCHEMA,
  })

  const parsed =
    parseJsonLoose<{
      titleZh?: string
      summaryPoints?: string[]
      eventBreakdown?: string
      transmission?: string
      liquidity?: string
      rateExpectation?: string
      sectorImpact?: string
      assets?: unknown
      watchlist?: string[]
      confidence?: number
    }>(detailResult.text) ?? {}

  const titleZh = (parsed.titleZh ?? article.titleZh ?? '').trim() || undefined
  const impact: NewsImpact = {
    articleId: article.id,
    headline: titleZh ?? article.title,
    eventBreakdown: parsed.eventBreakdown ?? article.summaryZh ?? article.summary,
    transmission: parsed.transmission ?? '',
    liquidity: parsed.liquidity ?? '',
    rateExpectation: parsed.rateExpectation ?? '',
    sectorImpact: parsed.sectorImpact ?? '',
    assets: normalizeAssets(parsed.assets),
    watchlist: Array.isArray(parsed.watchlist) && parsed.watchlist.length > 0 ? parsed.watchlist : article.tickers,
    confidence: clampPct(parsed.confidence, 60),
    generatedAt: now,
    model: detailResult.model,
    degraded: false,
  }

  // 全文整篇翻译（仅英文原文需要）
  let fullTextZh = article.lang === 'zh' ? fullText : ''
  if (article.lang === 'en' && fullText) {
    try {
      const translated = await generateServer({
        apiKey,
        model: SERVER_FLASH_MODEL,
        system: TRANSLATE_FULL_INSTRUCTION,
        prompt: fullText.slice(0, 14_000),
        temperature: 0.2,
        maxOutputTokens: 8192,
      })
      fullTextZh = translated.text.trim()
    } catch {
      fullTextZh = ''
    }
  }

  return {
    id: article.id,
    url: article.url,
    title: article.title,
    titleZh,
    sourceName: article.sourceName,
    publishedAt: article.publishedAt,
    summaryPoints: (parsed.summaryPoints ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 5),
    fullText,
    fullTextZh,
    impact,
    model: detailResult.model,
    extraction: fullText ? 'readability' : 'unavailable',
    cachedAt: now,
  }
}
