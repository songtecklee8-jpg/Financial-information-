import type {
  AiVerdict,
  AssetImpact,
  AssetKey,
  ChatMessage,
  ImpactDirection,
  NewsArticle,
  NewsImpact,
  Verdict,
} from '@/types'
import {
  VERDICT_INSTRUCTION,
  buildChatContextBlock,
  buildChatSystemInstruction,
  buildVerdictPayload,
  localVerdict,
  type AiContextInput,
} from '@/lib/aiContext'
import { ASSET_KEYS, assetLabel, localNewsImpact } from '@/lib/newsImpact'
import { clamp } from '@/lib/format'

/** Gemini 传输层 */

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'
const FALLBACK_MODEL = 'gemini-flash-latest'
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models'

export class GeminiError extends Error {
  readonly code?: number
  readonly hint?: string
  constructor(message: string, code?: number, hint?: string) {
    super(message)
    this.name = 'GeminiError'
    this.code = code
    this.hint = hint
  }
}

interface GeminiPart {
  text?: string
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] }
  finishReason?: string
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  error?: { code?: number; message?: string; status?: string }
  promptFeedback?: { blockReason?: string }
}

export interface GeminiContent {
  role: 'user' | 'model'
  parts: Array<{ text: string }>
}

interface GenerateOptions {
  apiKey: string
  model?: string
  systemInstruction?: string
  contents: GeminiContent[]
  jsonSchema?: Record<string, unknown>
  temperature?: number
  maxOutputTokens?: number
  signal?: AbortSignal
}

const VERDICT_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    verdict: {
      type: 'STRING',
      enum: ['UNDERVALUED', 'FAIRLY VALUED', 'OVERVALUED'],
      description: '综合价值裁决',
    },
    score: { type: 'INTEGER', description: '0-100 的综合性价比评分' },
    headline: { type: 'STRING', description: '一句话核心结论' },
    thesis: { type: 'STRING', description: '120 字以内的核心逻辑' },
    bullish: { type: 'ARRAY', items: { type: 'STRING' }, description: '看多理由 2-4 条' },
    bearish: { type: 'ARRAY', items: { type: 'STRING' }, description: '看空理由 2-4 条' },
    catalyst: { type: 'STRING', description: '关键催化剂' },
    risks: { type: 'STRING', description: '主要风险' },
  },
  required: ['verdict', 'score', 'headline', 'thesis', 'bullish', 'bearish', 'catalyst', 'risks'],
}

function extractText(payload: GeminiResponse): string {
  const candidate = payload.candidates?.[0]
  const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('').trim()
  if (text) return text
  if (payload.promptFeedback?.blockReason) {
    throw new GeminiError(`Gemini 拒绝了该请求（${payload.promptFeedback.blockReason}）`)
  }
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
    throw new GeminiError(`Gemini 返回被截断（${candidate.finishReason}），请重试或缩短上下文`)
  }
  throw new GeminiError('Gemini 未返回任何内容')
}

function describeHttpError(status: number, payload: GeminiResponse | null): GeminiError {
  const message = payload?.error?.message ?? ''
  if (status === 400 && /API key not valid/i.test(message)) {
    return new GeminiError('Gemini API Key 无效，请在「API 设置」中重新填写', status, message)
  }
  if (status === 403) {
    return new GeminiError('Gemini API Key 无权访问该模型，请检查权限或改用其它模型', status, message)
  }
  if (status === 429) {
    return new GeminiError('Gemini 触发配额限制，请稍后重试', status, message)
  }
  if (status === 404) {
    return new GeminiError(`模型不存在或不可用：${message || '未知模型'}`, status, message)
  }
  return new GeminiError(message || `Gemini 请求失败（HTTP ${status}）`, status)
}

async function callModel(options: GenerateOptions, model: string): Promise<string> {
  const body: Record<string, unknown> = {
    contents: options.contents,
    generationConfig: {
      temperature: options.temperature ?? 0.4,
      maxOutputTokens: options.maxOutputTokens ?? 2048,
      ...(options.jsonSchema
        ? { responseMimeType: 'application/json', responseSchema: options.jsonSchema }
        : {}),
    },
  }
  if (options.systemInstruction) {
    body.systemInstruction = { parts: [{ text: options.systemInstruction }] }
  }

  const response = await fetch(`${API_ROOT}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': options.apiKey,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  const payload = (await response.json().catch(() => null)) as GeminiResponse | null
  if (!response.ok) throw describeHttpError(response.status, payload)
  if (payload?.error) {
    throw new GeminiError(payload.error.message ?? 'Gemini 请求失败', payload.error.code)
  }
  return extractText(payload ?? {})
}

export async function generateText(options: GenerateOptions): Promise<{ text: string; model: string }> {
  if (!options.apiKey?.trim()) {
    throw new GeminiError('未配置 Gemini API Key', undefined, '请点击右上角「API 设置」填入 Key')
  }
  const primary = options.model?.trim() || DEFAULT_GEMINI_MODEL
  try {
    return { text: await callModel(options, primary), model: primary }
  } catch (error) {
    const isMissingModel =
      error instanceof GeminiError &&
      (error.code === 404 || /not found|unsupported|does not exist/i.test(error.message))
    if (isMissingModel && primary !== FALLBACK_MODEL) {
      return { text: await callModel(options, FALLBACK_MODEL), model: FALLBACK_MODEL }
    }
    throw error
  }
}

function parseJsonBlock<T>(text: string): T {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim()
  return JSON.parse(cleaned) as T
}

function normalizeVerdict(value: unknown): Verdict {
  const raw = String(value ?? '').toUpperCase().replace(/[_-]+/g, ' ').trim()
  if (raw.includes('UNDER')) return 'UNDERVALUED'
  if (raw.includes('OVER')) return 'OVERVALUED'
  return 'FAIRLY VALUED'
}

/** 运行深度 AI 诊断（结构化裁决） */
export async function runVerdictReport(
  input: AiContextInput,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<AiVerdict> {
  const { text, model: usedModel } = await generateText({
    apiKey,
    model,
    systemInstruction: VERDICT_INSTRUCTION,
    contents: [{ role: 'user', parts: [{ text: buildVerdictPayload(input) }] }],
    jsonSchema: VERDICT_SCHEMA,
    temperature: 0.35,
    maxOutputTokens: 2048,
    signal,
  })
  const parsed = parseJsonBlock<Partial<AiVerdict>>(text)
  return {
    verdict: normalizeVerdict(parsed.verdict),
    score: Math.max(0, Math.min(100, Math.round(Number(parsed.score ?? input.valuation.score)))),
    headline: parsed.headline ?? `${input.security.symbol} AI 综合价值裁决`,
    thesis: parsed.thesis ?? '',
    bullish: Array.isArray(parsed.bullish) ? parsed.bullish.slice(0, 5) : [],
    bearish: Array.isArray(parsed.bearish) ? parsed.bearish.slice(0, 5) : [],
    catalyst: parsed.catalyst ?? '',
    risks: parsed.risks ?? '',
    generatedAt: new Date().toISOString(),
    model: usedModel,
  }
}

/** 运行研究助理对话 */
export async function runChat(
  history: ChatMessage[],
  input: AiContextInput,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<{ text: string; model: string }> {
  const contents: GeminiContent[] = [
    { role: 'user', parts: [{ text: buildChatContextBlock(input) }] },
    {
      role: 'model',
      parts: [
        {
          text: `已载入 ${input.security.symbol}（${input.security.name}）的终端快照数据，可以开始提问。`,
        },
      ],
    },
    ...history
      .filter((message) => message.content.trim().length > 0)
      .slice(-10)
      .map<GeminiContent>((message) => ({
        role: message.role === 'user' ? 'user' : 'model',
        parts: [{ text: message.content }],
      })),
  ]
  return generateText({
    apiKey,
    model,
    systemInstruction: buildChatSystemInstruction(),
    contents,
    temperature: 0.5,
    maxOutputTokens: 1536,
    signal,
  })
}

/** 无 Key 时的本地兜底回复 */
export function localChatFallback(): string {
  return '当前未配置 Gemini API Key，AI 研究助理处于本地模式。请在右上角「API 设置」中填入 Gemini Key，即可针对该标的的财务指标、估值假设与宏观利率进行深度问答，并支持重新调整评分权重。'
}

// ---------------------------------------------------------------------------
// 财经新闻：全自动华文翻译
// ---------------------------------------------------------------------------

const TRANSLATE_INSTRUCTION = [
  '你是资深财经新闻翻译，负责把英文财经资讯翻译成流畅、专业的简体中文。',
  '要求：',
  '1. 保留专有名词、公司名、股票代码、数字与百分比，不要意译品牌与机构名称；',
  '2. 使用金融行业通用术语（如 Fed→美联储、Treasury yield→国债收益率、REITs→REITs）；',
  '3. 标题简洁有力（不超过 40 字），摘要通顺完整；',
  '4. 逐条返回，id 必须与输入完全一致，不得新增或遗漏条目；',
  '5. 只输出 JSON，不要任何解释性文字。',
].join('\n')

const TRANSLATE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: '与输入条目一致的 id' },
          titleZh: { type: 'STRING', description: '简体中文标题' },
          summaryZh: { type: 'STRING', description: '简体中文摘要' },
        },
        required: ['id', 'titleZh', 'summaryZh'],
      },
    },
  },
  required: ['items'],
}

interface TranslateRow {
  id?: string
  titleZh?: string
  summaryZh?: string
}

/** 单批翻译的条目数（控制单次请求 token 量） */
const TRANSLATE_BATCH = 20

/**
 * 批量英译华：把英文财经新闻翻译为流畅华文，写入 titleZh / summaryZh 并把
 * translation 标记为 done。未配置 Key 或某批次失败时，对应条目保留原文，界面永不空白。
 */
export async function translateArticles(
  articles: NewsArticle[],
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<NewsArticle[]> {
  const pending = articles.filter((article) => article.lang === 'en' && article.translation !== 'done')
  if (!apiKey?.trim() || pending.length === 0) return articles

  const translated = new Map<string, { titleZh: string; summaryZh: string }>()
  for (let i = 0; i < pending.length; i += TRANSLATE_BATCH) {
    const chunk = pending.slice(i, i + TRANSLATE_BATCH)
    const payload = JSON.stringify(
      chunk.map((article) => ({
        id: article.id,
        title: article.title,
        summary: article.summary.slice(0, 280),
      })),
    )
    try {
      const { text } = await generateText({
        apiKey,
        model,
        systemInstruction: TRANSLATE_INSTRUCTION,
        contents: [{ role: 'user', parts: [{ text: payload }] }],
        jsonSchema: TRANSLATE_SCHEMA,
        temperature: 0.2,
        maxOutputTokens: 4096,
        signal,
      })
      const parsed = parseJsonBlock<{ items?: TranslateRow[] }>(text)
      for (const row of parsed.items ?? []) {
        if (!row.id) continue
        const titleZh = (row.titleZh ?? '').trim()
        const summaryZh = (row.summaryZh ?? '').trim()
        if (titleZh) translated.set(row.id, { titleZh, summaryZh: summaryZh || titleZh })
      }
    } catch (error) {
      // 用户主动中止：向上抛；单批翻译失败：跳过该批，保留原文
      if (signal?.aborted) throw error
    }
  }

  if (translated.size === 0) return articles
  return articles.map((article) => {
    const hit = translated.get(article.id)
    if (!hit) return article
    return { ...article, titleZh: hit.titleZh, summaryZh: hit.summaryZh, translation: 'done' as const }
  })
}

// ---------------------------------------------------------------------------
// 财经新闻：AI 跨市场深度推演（五大资产涨跌概率）
// ---------------------------------------------------------------------------

const IMPACT_INSTRUCTION = [
  '你是横跨美股、马来西亚（Bursa Malaysia）、债券、房地产、黄金与衍生品的首席宏观策略师。',
  '针对给定的一条财经新闻，输出结构化、可量化的跨市场推演，全部使用通俗专业的简体中文。',
  '必须严格遵守：',
  '1. 强制对以下 5 类资产分别给出判断，缺一不可，顺序固定：',
  '   equities（股票：需区分美股大盘/科技股与马股 Bursa Malaysia 相关板块）、',
  '   bonds（债券：美国国债收益率与价格、马来西亚 MGS 政府债券）、',
  '   realEstate（房地产 / REITs：利率与通胀预期对商业地产及马股/美股 REITs 的冲击）、',
  '   gold（黄金：避险情绪与美元强弱对现货金价的影响）、',
  '   volatility（期权与波动率：隐含波动率 IV 升降方向，以及 Call 与 Put 的策略倾向）；',
  '2. 每类资产给出 up（上涨概率 %，整数）与 down（下跌概率 %，整数），二者相加必须等于 100；',
  '3. direction 取 bullish（看涨）/ bearish（看跌）/ neutral（震荡）；',
  '4. driver 为一句话核心驱动逻辑，detail 为细分说明（如美股大盘 / 科技股 / 马股板块）；',
  '5. confidence 为 0-100 的整数置信度；',
  '6. 只输出 JSON，不要任何解释性文字。',
].join('\n')

const IMPACT_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    eventBreakdown: { type: 'STRING', description: '核心事件拆解，80-140 字' },
    transmission: { type: 'STRING', description: '传导逻辑' },
    liquidity: { type: 'STRING', description: '对宏观流动性的影响' },
    rateExpectation: { type: 'STRING', description: '对利率预期的影响' },
    sectorImpact: { type: 'STRING', description: '行业基本面影响' },
    assets: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          asset: {
            type: 'STRING',
            enum: ['equities', 'bonds', 'realEstate', 'gold', 'volatility'],
          },
          up: { type: 'INTEGER', description: '上涨概率 0-100' },
          down: { type: 'INTEGER', description: '下跌概率 0-100，up+down=100' },
          direction: { type: 'STRING', enum: ['bullish', 'bearish', 'neutral'] },
          driver: { type: 'STRING', description: '一句话核心驱动逻辑' },
          detail: { type: 'STRING', description: '细分说明' },
        },
        required: ['asset', 'up', 'down', 'direction', 'driver', 'detail'],
      },
    },
    watchlist: { type: 'ARRAY', items: { type: 'STRING' }, description: '值得关注的标的 / 指标' },
    confidence: { type: 'INTEGER', description: '0-100 置信度' },
  },
  required: [
    'eventBreakdown',
    'transmission',
    'liquidity',
    'rateExpectation',
    'sectorImpact',
    'assets',
    'watchlist',
    'confidence',
  ],
}

function normalizeDirection(value: unknown, up: number): ImpactDirection {
  const raw = String(value ?? '').toLowerCase().trim()
  if (raw.includes('bull')) return 'bullish'
  if (raw.includes('bear')) return 'bearish'
  if (raw.includes('neutral') || raw.includes('side') || raw.includes('震荡')) return 'neutral'
  if (up >= 58) return 'bullish'
  if (up <= 42) return 'bearish'
  return 'neutral'
}

function buildImpactPayload(article: NewsArticle): string {
  const region = article.region === 'malaysia' ? '马来西亚' : '全球'
  const tone =
    article.sentiment === 'bullish' ? '偏多' : article.sentiment === 'bearish' ? '偏空' : '中性'
  return [
    `标题：${article.title}`,
    article.titleZh ? `华文标题：${article.titleZh}` : '',
    `来源：${article.sourceName}（${region}）`,
    `发布时间：${article.publishedAt}`,
    `摘要：${article.summary.slice(0, 500)}`,
    `相关标的：${article.tickers.length > 0 ? article.tickers.join('、') : '未识别'}`,
    `当前情绪倾向：${tone}`,
    `分类：${article.categories.join('、')}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function normalizeImpact(
  parsed: Partial<NewsImpact> & { assets?: Array<Partial<AssetImpact>> },
  article: NewsArticle,
  fallback: NewsImpact,
  model: string,
): NewsImpact {
  const byKey = new Map<AssetKey, Partial<AssetImpact>>()
  for (const item of parsed.assets ?? []) {
    const key = String(item.asset ?? '') as AssetKey
    if (ASSET_KEYS.includes(key)) byKey.set(key, item)
  }

  const assets: AssetImpact[] = ASSET_KEYS.map((key) => {
    const item = byKey.get(key)
    const base = fallback.assets.find((entry) => entry.asset === key)!
    const rawUp = Number(item?.up)
    const up = Number.isFinite(rawUp) ? clamp(Math.round(rawUp), 5, 95) : base.up
    const driver = (item?.driver ?? '').trim()
    const detail = (item?.detail ?? '').trim()
    return {
      asset: key,
      label: assetLabel(key),
      up,
      down: 100 - up,
      direction: normalizeDirection(item?.direction, up),
      driver: driver || base.driver,
      detail: detail || base.detail,
    }
  })

  return {
    articleId: article.id,
    headline: article.titleZh ?? article.title,
    eventBreakdown: (parsed.eventBreakdown ?? '').trim() || fallback.eventBreakdown,
    transmission: (parsed.transmission ?? '').trim() || fallback.transmission,
    liquidity: (parsed.liquidity ?? '').trim() || fallback.liquidity,
    rateExpectation: (parsed.rateExpectation ?? '').trim() || fallback.rateExpectation,
    sectorImpact: (parsed.sectorImpact ?? '').trim() || fallback.sectorImpact,
    assets,
    watchlist: Array.isArray(parsed.watchlist)
      ? parsed.watchlist.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
      : fallback.watchlist,
    confidence: Number.isFinite(Number(parsed.confidence))
      ? clamp(Math.round(Number(parsed.confidence)), 0, 100)
      : 72,
    generatedAt: new Date().toISOString(),
    model,
  }
}

/**
 * 对单条新闻运行 AI 跨市场深度推演，输出五大资产的上涨 / 下跌概率。
 * 未配置 Key 或调用失败时，自动回退本地启发式推演（degraded: true）。
 */
export async function runNewsImpact(
  article: NewsArticle,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<NewsImpact> {
  if (!apiKey?.trim()) return localNewsImpact(article)
  try {
    const { text, model: usedModel } = await generateText({
      apiKey,
      model,
      systemInstruction: IMPACT_INSTRUCTION,
      contents: [{ role: 'user', parts: [{ text: buildImpactPayload(article) }] }],
      jsonSchema: IMPACT_SCHEMA,
      temperature: 0.35,
      maxOutputTokens: 2560,
      signal,
    })
    const parsed = parseJsonBlock<Partial<NewsImpact> & { assets?: Array<Partial<AssetImpact>> }>(text)
    return normalizeImpact(parsed, article, localNewsImpact(article), usedModel)
  } catch (error) {
    if (signal?.aborted) throw error
    return localNewsImpact(article)
  }
}

export { localVerdict }
