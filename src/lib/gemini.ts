import type {
  AiRoutingMode,
  AiVerdict,
  ApiSettings,
  AssetImpact,
  AssetKey,
  ChatMessage,
  ImpactDirection,
  MacroCycleAnalysis,
  MacroRates,
  NewsArticle,
  NewsDetail,
  NewsImpact,
  PaperProfile,
  ProfileStats,
  RelayMeta,
  TradeReview,
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
import {
  BATON_META,
  callBackupProvidersClient,
  callRelayViaServerProxy,
  canTryServerProxy,
  collectClientGeminiKeys,
  formatBackupModelDisplay,
  getActiveAiFallbackConfig,
  hasAnyServerEnvAi,
  hasConfiguredBackupAi,
  inferRelayFromModel,
  recordClientProviderFailure,
  recordClientProviderSuccess,
  type ClientAiTier,
} from '@/lib/aiFallback'
import { RESEARCH_DOCTRINE } from '@/lib/researchDoctrine'
import { buildTradeReviewPayload, localTradeReview } from '@/lib/trading'
import { clamp } from '@/lib/format'

/** Gemini 传输层 + 永久免费多服务商兜底调度 */

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models'

// ---------------------------------------------------------------------------
// 三级 AI 模型路由（Lite / Flash / Pro）+ 无缝降级熔断
// ---------------------------------------------------------------------------

/** AI 能力层级 */
export type AiTier = 'lite' | 'flash' | 'pro'

/** 由弱到强的层级顺序，用于向下降级 */
export const TIER_ORDER: AiTier[] = ['lite', 'flash', 'pro']

/** 各层级对应的 Gemini 模型 */
export const TIER_MODEL: Record<AiTier, string> = {
  lite: 'gemini-2.5-flash-lite',
  flash: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
}

/** 层级展示名 */
export const TIER_LABEL: Record<AiTier, string> = {
  lite: 'Gemini 2.5 Flash-Lite',
  flash: 'Gemini 2.5 Flash',
  pro: 'Gemini 2.5 Pro',
}

/** 层级职责说明 */
export const TIER_ROLE: Record<AiTier, string> = {
  lite: '高频批量吞吐（新闻华文翻译与情绪标签）',
  flash: '即时交互研判（五大资产概率仪表盘、个股量化诊断）',
  pro: '旗舰深度推理（多账户交易复盘、宏观周期推演）',
}

/** 终极兜底别名：当全部层级模型均不可用时的最后尝试 */
const LAST_RESORT_MODEL = 'gemini-flash-latest'

/** 单次 AI 调用的路由参数 */
export interface AiRoute {
  /** 路由模式：auto 走 tier，其余为手动锁定 */
  mode: AiRoutingMode
  /** 任务所需层级（auto 模式下生效） */
  tier: AiTier
  /** 高级：自定义模型覆盖（优先级最高） */
  override?: string
}

/** 根据设置与任务层级构造路由参数 */
export function aiRoute(settings: ApiSettings, tier: AiTier): AiRoute {
  return {
    mode: settings.aiRouting ?? 'auto',
    tier,
    override: settings.geminiModel?.trim() || undefined,
  }
}

/** 手动锁定模式解析为起始层级 */
function resolveStartTier(route: AiRoute): AiTier {
  if (route.mode === 'pro' || route.mode === 'flash' || route.mode === 'lite') return route.mode
  return route.tier
}

/**
 * 生成候选模型链：从目标层级开始逐级向下降级。
 * Pro → Flash → Flash-Lite，确保任何一级限流 / 不可用时都不会中断。
 */
export function modelChain(route: AiRoute): string[] {
  const chain: string[] = []
  const push = (model: string) => {
    if (model && !chain.includes(model)) chain.push(model)
  }
  if (route.override) push(route.override)
  const startIndex = TIER_ORDER.indexOf(resolveStartTier(route))
  for (let i = startIndex; i >= 0; i -= 1) push(TIER_MODEL[TIER_ORDER[i]])
  push(LAST_RESORT_MODEL)
  return chain
}

/** 把模型 id 转为友好展示名，用于分析卡片角标 */
export function modelDisplayName(model: string): string {
  const raw = (model ?? '').trim()
  const value = raw.toLowerCase()
  if (!value || value === 'local' || value === 'local-quant-engine' || value === 'unavailable') {
    return '本地量化引擎'
  }
  if (raw.includes(' + ')) {
    return raw
      .split(' + ')
      .map((part) => modelDisplayName(part))
      .slice(0, 2)
      .join(' + ')
  }
  if (
    value.startsWith('groq/') ||
    value.startsWith('openrouter/') ||
    value.startsWith('cerebras/') ||
    value.startsWith('nvidia/') ||
    value.startsWith('cloudflare/') ||
    value.startsWith('mistral/') ||
    value.startsWith('cohere/') ||
    value.startsWith('custom1/') ||
    value.startsWith('custom2/')
  ) {
    return formatBackupModelDisplay(raw)
  }
  if (value.includes('2.5-pro')) return 'Gemini 2.5 Pro'
  if (value.includes('2.5-flash-lite')) return 'Gemini 2.5 Flash-Lite'
  if (value.includes('2.5-flash')) return 'Gemini 2.5 Flash'
  if (value.includes('flash-latest')) return 'Gemini Flash Latest'
  if (value.includes('2.0-flash')) return 'Gemini 2.0 Flash'
  return raw
}


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
  /** 三级路由参数（决定主模型与降级链） */
  route: AiRoute
  systemInstruction?: string
  contents: GeminiContent[]
  jsonSchema?: Record<string, unknown>
  temperature?: number
  maxOutputTokens?: number
  signal?: AbortSignal
  /** 批量并发任务时，若 Gemini 并发槽满可分流至免费备用服务商 */
  allowConcurrencyOffload?: boolean
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

/** API Key 本身无效时降级无意义，直接终止 */
function isFatalKeyError(error: unknown): boolean {
  return (
    error instanceof GeminiError &&
    error.code === 400 &&
    /api key|API_KEY_INVALID/i.test(error.message)
  )
}

function toBackupMessages(
  contents: GeminiContent[],
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return contents.map((item) => ({
    role: item.role === 'model' ? 'assistant' : 'user',
    content: item.parts.map((part) => part.text ?? '').join(''),
  }))
}

/**
 * 第 1 棒（Google Gemini）：按多把 Key 内部轮询并结合模型降级链依次尝试。
 */
async function callGeminiWithFallback(
  options: GenerateOptions,
  geminiKeys: string[],
  chain: string[],
  allowKeyFallback: boolean,
): Promise<{ text: string; model: string; relay: RelayMeta }> {
  let lastError: unknown
  for (const key of geminiKeys) {
    for (const model of chain) {
      try {
        const text = await callModel({ ...options, apiKey: key }, model)
        recordClientProviderSuccess('gemini')
        return {
          text,
          model,
          relay: {
            baton: BATON_META.gemini.baton,
            providerId: 'gemini',
            providerName: BATON_META.gemini.name,
            model,
          },
        }
      } catch (error) {
        lastError = error
        if (options.signal?.aborted) throw error
        const status = error instanceof GeminiError ? error.code : undefined
        const msg = error instanceof Error ? error.message : String(error)
        recordClientProviderFailure('gemini', status, msg)
        // 当前 Gemini Key 限流或无效时，切换下一把 Gemini Key
        if (status === 429 || (!allowKeyFallback && isFatalKeyError(error)) || isFatalKeyError(error)) {
          break
        }
      }
    }
  }
  throw lastError instanceof Error ? lastError : new GeminiError('Gemini 请求失败')
}

/**
 * 统一 AI “接力赛”调用入口：
 * 1) 优先经同源 `/api/ai/complete` 代理（合并 Vercel 环境变量与本地 Key，严防秘密泄露，支持第 1→10 棒接力）；
 * 2) 若处于纯静态部署（后端接口不可达），自动回落浏览器端严格第 1→10 棒接力（Gemini 多 Key 轮询 → Groq → OpenRouter → Cerebras → NVIDIA → Cloudflare → Mistral → Cohere → 自定义 1/2）。
 */
export async function generateText(
  options: GenerateOptions,
): Promise<{ text: string; model: string; relay: RelayMeta }> {
  const tier: ClientAiTier = resolveStartTier(options.route)
  const fallbackConfig = getActiveAiFallbackConfig()
  const geminiKeys = collectClientGeminiKeys({
    geminiKey: options.apiKey,
    aiFallback: fallbackConfig,
  })
  const hasGemini = geminiKeys.length > 0
  const backupsReady = hasConfiguredBackupAi(fallbackConfig)
  const serverAiReady = hasAnyServerEnvAi()

  if (!hasGemini && !backupsReady && !serverAiReady && !canTryServerProxy()) {
    throw new GeminiError(
      '未配置任何 AI 接力赛密钥',
      undefined,
      '请点击右上角「API 接力赛配置」填入 Gemini Key 或第 2–10 棒任一备用通道密钥',
    )
  }

  // 1) 优先走后端统一接力代理（兼顾 Vercel 环境变量、防 CORS、不泄露密钥）
  if (canTryServerProxy()) {
    try {
      return await callRelayViaServerProxy({
        geminiKey: options.apiKey,
        aiRouting: options.route.mode,
        customModel: options.route.override,
        system: options.systemInstruction ?? '',
        messages: toBackupMessages(options.contents),
        tier,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        expectJson: Boolean(options.jsonSchema),
        responseSchema: options.jsonSchema,
        signal: options.signal,
        config: fallbackConfig,
      })
    } catch (proxyErr) {
      if (options.signal?.aborted) throw proxyErr
      const msg = proxyErr instanceof Error ? proxyErr.message : String(proxyErr)
      const isProxyUnavailable =
        msg.startsWith('PROXY_UNAVAILABLE_') || proxyErr instanceof TypeError
      if (!isProxyUnavailable) {
        // 如果服务端明确报告均失败，在确认本地有额外直连配置时仍可不做重复浪费，直接抛出明确错误
        throw new GeminiError(msg)
      }
    }
  }

  if (!hasGemini && !backupsReady) {
    throw new GeminiError(
      '未配置 Gemini 或免费备用 AI Key',
      undefined,
      '请点击右上角「API 接力赛配置」填入 Gemini Key 或任一备用接力通道 Key',
    )
  }

  const chain = modelChain(options.route)

  // 2) 第 1 棒：Google Gemini（多 Key 内部轮询）
  if (hasGemini) {
    try {
      return await callGeminiWithFallback(options, geminiKeys, chain, backupsReady)
    } catch (geminiError) {
      if (options.signal?.aborted || !backupsReady) throw geminiError
    }
  }

  // 3) 第 2–10 棒接力（Groq → OpenRouter → Cerebras → NVIDIA → Cloudflare → Mistral → Cohere → 自定义 1/2）
  return await callBackupProvidersClient({
    system: options.systemInstruction ?? '',
    messages: toBackupMessages(options.contents),
    tier,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
    expectJson: Boolean(options.jsonSchema),
    signal: options.signal,
    config: fallbackConfig,
  })
}

export function parseJsonBlock<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = (fenced ? fenced[1] : text)
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim()
  try {
    return JSON.parse(candidate) as T
  } catch {
    const start = candidate.search(/[[{]/)
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as T
    }
    throw new SyntaxError('无法从模型输出中解析合法 JSON')
  }
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
  route: AiRoute,
  signal?: AbortSignal,
): Promise<AiVerdict> {
  const { text, model: usedModel } = await generateText({
    apiKey,
    route,
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
  route: AiRoute,
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
    route,
    systemInstruction: buildChatSystemInstruction(),
    contents,
    temperature: 0.5,
    maxOutputTokens: 1536,
    signal,
  })
}

/** 无 Key 时的本地兜底回复 */
export function localChatFallback(): string {
  return '当前未配置 Gemini 或免费备用 AI Key，研究助理处于本地模式。请在右上角「API 设置」中填入 Gemini Key（或 Groq / OpenRouter / Mistral 等免费备用 Key），即可针对该标的的财务指标、估值假设与宏观利率进行深度问答。'
}

// ---------------------------------------------------------------------------
// 财经新闻：全自动华文翻译
// ---------------------------------------------------------------------------

const TRANSLATE_INSTRUCTION = [
  '你是资深财经新闻翻译，负责把英文财经资讯翻译成流畅、专业的简体中文，并给出多空情绪标签。',
  '要求：',
  '1. 保留专有名词、公司名、股票代码、数字与百分比，不要意译品牌与机构名称；',
  '2. 使用金融行业通用术语（如 Fed→美联储、Treasury yield→国债收益率、REITs→REITs）；',
  '3. 标题简洁有力（不超过 40 字），摘要通顺完整；',
  '4. 为每条新闻判断市场情绪：bullish（利好）/ bearish（利空）/ neutral（中性）；',
  '5. 逐条返回，id 必须与输入完全一致，不得新增或遗漏条目；',
  '6. 只输出 JSON，不要任何解释性文字。',
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
          sentiment: {
            type: 'STRING',
            enum: ['bullish', 'bearish', 'neutral'],
            description: '多空情绪标签',
          },
        },
        required: ['id', 'titleZh', 'summaryZh', 'sentiment'],
      },
    },
  },
  required: ['items'],
}

interface TranslateRow {
  id?: string
  titleZh?: string
  summaryZh?: string
  sentiment?: string
}

/** 单批翻译的条目数（控制单次请求 token 量） */
const TRANSLATE_BATCH = 20

function normalizeSentiment(value: unknown): NewsArticle['sentiment'] {
  const raw = String(value ?? '').toLowerCase()
  if (raw.includes('bull')) return 'bullish'
  if (raw.includes('bear')) return 'bearish'
  return 'neutral'
}

/**
 * 批量英译华：把英文财经新闻翻译为流畅华文并生成多空情绪标签，写入
 * titleZh / summaryZh / sentiment 并把 translation 标记为 done。
 * 未配置 Key 或某批次失败时，对应条目保留原文，界面永不空白。
 */
export async function translateArticles(
  articles: NewsArticle[],
  apiKey: string,
  route: AiRoute,
  signal?: AbortSignal,
): Promise<{ articles: NewsArticle[]; model: string | null }> {
  const pending = articles.filter((article) => article.lang === 'en' && article.translation !== 'done')
  const anyAi = Boolean(apiKey?.trim()) || hasConfiguredBackupAi() || hasAnyServerEnvAi()
  if (!anyAi || pending.length === 0) {
    return { articles, model: null }
  }

  const translated = new Map<
    string,
    { titleZh: string; summaryZh: string; sentiment: NewsArticle['sentiment'] }
  >()
  const usedModels = new Set<string>()
  const chunks: NewsArticle[][] = []
  for (let i = 0; i < pending.length; i += TRANSLATE_BATCH) {
    chunks.push(pending.slice(i, i + TRANSLATE_BATCH))
  }

  let cursor = 0
  const concurrency = Math.min(3, chunks.length)
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < chunks.length) {
        if (signal?.aborted) return
        const chunk = chunks[cursor]
        cursor += 1
        if (!chunk) continue
        const payload = JSON.stringify(
          chunk.map((article) => ({
            id: article.id,
            title: article.title,
            summary: article.summary.slice(0, 280),
          })),
        )
        try {
          const { text, model } = await generateText({
            apiKey,
            route,
            systemInstruction: TRANSLATE_INSTRUCTION,
            contents: [{ role: 'user', parts: [{ text: payload }] }],
            jsonSchema: TRANSLATE_SCHEMA,
            temperature: 0.2,
            maxOutputTokens: 4096,
            signal,
            allowConcurrencyOffload: chunks.length > 1,
          })
          if (model) usedModels.add(model)
          const parsed = parseJsonBlock<{ items?: TranslateRow[] }>(text)
          for (const row of parsed.items ?? []) {
            if (!row.id) continue
            const titleZh = (row.titleZh ?? '').trim()
            const summaryZh = (row.summaryZh ?? '').trim()
            if (titleZh) {
              translated.set(row.id, {
                titleZh,
                summaryZh: summaryZh || titleZh,
                sentiment: normalizeSentiment(row.sentiment),
              })
            }
          }
        } catch (error) {
          if (signal?.aborted) throw error
        }
      }
    }),
  )

  const usedModel = usedModels.size > 0 ? [...usedModels].slice(0, 2).join(' + ') : null
  if (translated.size === 0) return { articles, model: usedModel }
  return {
    articles: articles.map((article) => {
      const hit = translated.get(article.id)
      if (!hit) return article
      return {
        ...article,
        titleZh: hit.titleZh,
        summaryZh: hit.summaryZh,
        sentiment: hit.sentiment,
        translation: 'done' as const,
      }
    }),
    model: usedModel,
  }
}

// ---------------------------------------------------------------------------
// 财经新闻：AI 跨市场深度推演（五大资产涨跌概率）
// ---------------------------------------------------------------------------

const IMPACT_INSTRUCTION = `${RESEARCH_DOCTRINE}

你是横跨美股、马来西亚（Bursa Malaysia）、债券、房地产、黄金与衍生品的首席宏观策略师。
针对给定的一条财经新闻，输出结构化、可量化的跨市场推演，全部使用通俗专业的简体中文。
必须严格遵守：
1. 强制对以下 5 类资产分别给出判断，缺一不可，顺序固定：
   equities（股票：需区分美股大盘/科技股与马股 Bursa Malaysia 相关板块）、
   bonds（债券：美国国债收益率与价格、马来西亚 MGS 政府债券）、
   realEstate（房地产 / REITs：利率与通胀预期对商业地产及马股/美股 REITs 的冲击）、
   gold（黄金：避险情绪与美元强弱对现货金价的影响）、
   volatility（期权与波动率：隐含波动率 IV 升降方向，以及 Call 与 Put 的策略倾向）；
2. 每类资产给出 up（上涨概率 %，整数）与 down（下跌概率 %，整数），二者相加必须等于 100；
3. direction 取 bullish（看涨）/ bearish（看跌）/ neutral（震荡）；
4. driver 为一句话核心驱动逻辑，detail 为细分说明（如美股大盘 / 科技股 / 马股板块）；
5. confidence 为 0-100 的整数置信度；
6. 传导逻辑须显式引用至少一个历史相似情景（如 1997 亚洲金融风暴、2008 次贷危机、2020 流动性冲击、2022 激进加息）与一个理论框架（DCF / CAPM / MPT / 凯利公式 / Greeks）；
7. 只输出 JSON，不要任何解释性文字。`

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
  route: AiRoute,
  signal?: AbortSignal,
): Promise<NewsImpact> {
  if (!apiKey?.trim() && !hasConfiguredBackupAi() && !hasAnyServerEnvAi()) return localNewsImpact(article)
  try {
    const { text, model: usedModel } = await generateText({
      apiKey,
      route,
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

// ---------------------------------------------------------------------------
// 模拟交易：AI 账户复盘与诊断
// ---------------------------------------------------------------------------

const TRADE_REVIEW_INSTRUCTION = `${RESEARCH_DOCTRINE}

你是顶级对冲基金的交易风控主管（Head of Risk & Trading Review），负责对交易员的账户表现做无情但公正的复盘。
你会收到某个模拟交易账户（Profile）的完整快照：本金、现金、持仓与集中度、成交流水、盈亏比、胜率、最大回撤以及当前市场环境。
必须输出结构化、可落地的复盘，全部使用简体中文。

输出要求：
1. headline：一句话总结该账户当前的整体状态（不超过 40 字）。
2. strengths（做得好的地方）：客观肯定真实亮点，例如仓位控制、顺势交易、止盈执行、风险分散（夏普比率体现）、行业轮动把握、纪律性等；2-4 条，每条 30 字以内。若确实没有亮点，必须诚实说明并给出当前唯一可肯定之处，禁止编造。
3. improvements（需要改善的地方）：精准指出交易缺陷，例如过度集中单一板块、逆势加仓、缺乏止损纪律、频繁交易损耗、忽视宏观利率风险、追高杀跌等；2-4 条，每条 30 字以内。
4. riskPlan：给出具体可落地的仓位调整与风控方案。必须包含：基于凯利公式（含半凯利）的目标单笔仓位建议、基于 MPT 的分散化建议、明确的止损 / 止盈规则，并结合当前利率与美元兑令吉（USD/MYR）汇率环境；不超过 200 字。
5. disciplineScore：0-100 的交易纪律评分（越高越自律）。

注意：所有判断必须引用给定数据中的具体数字；若数据不足（如成交笔数过少），须明确指出「样本不足，结论置信度有限」。只输出 JSON，不要任何解释性文字。`

const TRADE_REVIEW_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING', description: '一句话账户状态总结' },
    strengths: { type: 'ARRAY', items: { type: 'STRING' }, description: '做得好的地方 2-4 条' },
    improvements: { type: 'ARRAY', items: { type: 'STRING' }, description: '需要改善的地方 2-4 条' },
    riskPlan: { type: 'STRING', description: '具体可落地的仓位调整与风控方案' },
    disciplineScore: { type: 'INTEGER', description: '0-100 交易纪律评分' },
  },
  required: ['headline', 'strengths', 'improvements', 'riskPlan', 'disciplineScore'],
}

/**
 * 对单个模拟交易账户运行 AI 深度复盘。
 * 未配置 Key 或调用失败时，回退本地启发式复盘（degraded: true）。
 */
export async function runTradeReview(
  profile: PaperProfile,
  stats: ProfileStats,
  apiKey: string,
  route: AiRoute,
  signal?: AbortSignal,
): Promise<TradeReview> {
  if (!apiKey?.trim() && !hasConfiguredBackupAi()) return localTradeReview(profile, stats)
  try {
    const { text, model: usedModel } = await generateText({
      apiKey,
      route,
      systemInstruction: TRADE_REVIEW_INSTRUCTION,
      contents: [{ role: 'user', parts: [{ text: buildTradeReviewPayload(profile, stats) }] }],
      jsonSchema: TRADE_REVIEW_SCHEMA,
      temperature: 0.4,
      maxOutputTokens: 2048,
      signal,
    })
    const parsed = parseJsonBlock<Partial<TradeReview>>(text)
    return {
      profileId: profile.id,
      headline: (parsed.headline ?? '').trim() || `${profile.name} 交易复盘`,
      strengths: Array.isArray(parsed.strengths)
        ? parsed.strengths.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
        : [],
      improvements: Array.isArray(parsed.improvements)
        ? parsed.improvements.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
        : [],
      riskPlan: (parsed.riskPlan ?? '').trim(),
      disciplineScore: Number.isFinite(Number(parsed.disciplineScore))
        ? clamp(Math.round(Number(parsed.disciplineScore)), 0, 100)
        : 60,
      generatedAt: new Date().toISOString(),
      model: usedModel,
    }
  } catch (error) {
    if (signal?.aborted) throw error
    return localTradeReview(profile, stats)
  }
}

// ---------------------------------------------------------------------------
// 单篇新闻详情（浏览器端增强：摘要要点 + 全文翻译 + 五大资产推演）
// ---------------------------------------------------------------------------

const CLIENT_DETAIL_INSTRUCTION = `${RESEARCH_DOCTRINE}

你是资深全球宏观与跨市场策略师，负责把给定财经新闻提炼为结构化华文投研摘要，并输出五大资产（equities / bonds / realEstate / gold / volatility）的上涨与下跌概率。
要求：
1. summaryPoints：3-5 条凝练的简体中文核心要点，每条不超过 45 字，保留关键数字与实体；
2. titleZh：流畅准确的简体中文标题；
3. 五大资产顺序固定，每类资产 up + down = 100；
4. 只输出 JSON。`

const CLIENT_DETAIL_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    titleZh: { type: 'STRING' },
    summaryPoints: { type: 'ARRAY', items: { type: 'STRING' } },
    eventBreakdown: { type: 'STRING' },
    transmission: { type: 'STRING' },
    liquidity: { type: 'STRING' },
    rateExpectation: { type: 'STRING' },
    sectorImpact: { type: 'STRING' },
    assets: IMPACT_SCHEMA.properties ? (IMPACT_SCHEMA.properties as Record<string, unknown>).assets : { type: 'ARRAY' },
    watchlist: { type: 'ARRAY', items: { type: 'STRING' } },
    confidence: { type: 'INTEGER' },
  },
  required: [
    'titleZh',
    'summaryPoints',
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

export async function runNewsDetailClient(
  article: NewsArticle,
  fullText: string,
  extraction: NewsDetail['extraction'],
  apiKey: string,
  route: AiRoute,
  signal?: AbortSignal,
): Promise<NewsDetail> {
  const fallback = localNewsImpact(article)
  const body = (fullText || article.summary || article.title).slice(0, 10_000)
  if (!apiKey?.trim() && !hasConfiguredBackupAi() && !hasAnyServerEnvAi()) {
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
      impact: fallback,
      model: 'local',
      extraction,
      cachedAt: new Date().toISOString(),
    }
  }

  const detailReq = generateText({
    apiKey,
    route,
    systemInstruction: CLIENT_DETAIL_INSTRUCTION,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `${buildImpactPayload(article)}\n\n正文：\n${body}`,
          },
        ],
      },
    ],
    jsonSchema: CLIENT_DETAIL_SCHEMA,
    temperature: 0.3,
    maxOutputTokens: 3072,
    signal,
  })

  const translateReq =
    article.lang === 'en' && fullText.trim().length > 0
      ? generateText({
          apiKey,
          route: { ...route, tier: 'lite' },
          systemInstruction:
            '你是资深财经翻译，请把以下英文财经新闻全文完整翻译成流畅、专业的简体中文。保留数字、公司名与专有名词，按自然段输出译文，不要省略或总结。',
          contents: [{ role: 'user', parts: [{ text: fullText.slice(0, 12_000) }] }],
          temperature: 0.2,
          maxOutputTokens: 6144,
          signal,
          allowConcurrencyOffload: true,
        }).catch(() => null)
      : Promise.resolve(null)

  const [detailRes, translatedRes] = await Promise.all([detailReq, translateReq])
  const parsed = parseJsonBlock<
    Partial<NewsImpact> & {
      titleZh?: string
      summaryPoints?: string[]
      assets?: Array<Partial<AssetImpact>>
    }
  >(detailRes.text)

  const impact = normalizeImpact(parsed, article, fallback, detailRes.model)
  const titleZh = (parsed.titleZh ?? article.titleZh ?? '').trim() || undefined
  const summaryPoints = Array.isArray(parsed.summaryPoints)
    ? parsed.summaryPoints.map((p) => String(p).trim()).filter(Boolean).slice(0, 5)
    : []

  return {
    id: article.id,
    url: article.url,
    title: article.title,
    titleZh,
    sourceName: article.sourceName,
    publishedAt: article.publishedAt,
    summaryPoints,
    fullText,
    fullTextZh: article.lang === 'zh' ? fullText : translatedRes?.text.trim() ?? '',
    impact,
    model: detailRes.model,
    extraction,
    cachedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// 宏观周期：Pro 级深度跨市场宏观周期推演
// ---------------------------------------------------------------------------

const MACRO_CYCLE_INSTRUCTION = `${RESEARCH_DOCTRINE}

你是顶级的全球宏观与跨市场首席策略师，覆盖美股、马来西亚 Bursa 市场、主权债（美债与大马 MGS）、REITs、黄金与波动率衍生品。
请根据给定的实时美债收益率曲线、马来西亚 MGS / BNM OPR 政策利率、美马 10Y 利差与最新财经标题，输出结构化的「深度跨市场宏观周期推演」。
必须严格遵守：
1. cyclePhase：明确判断当前所处的宏观周期阶段（不超过 18 字，例如「高利率平台期 · 温差收敛」）；
2. headline：一句话核心定调（不超过 42 字）；
3. transmission：深度解析美债收益率、BNM OPR 与美马利差如何向风险资产、马币汇率与估值折现率传导（140 字以内）；
4. historicalAnalogy：显式映射至少一个历史周期情景（如 1997 亚洲金融风暴、2008 次贷危机、2020 流动性冲击、2022 激进加息）并指出异同（100 字以内）；
5. allocations：固定输出 5 类资产判断（美股权益、马股 Bursa、美债与 MGS、黄金与商品、波动率与现金），bias 取 bullish / bearish / neutral，rationale 控制在 35 字以内；
6. riskNote：最需要警惕的尾部风险与观察指标（60 字以内）；
7. 所有数据必须严格来自输入，禁止编造；全部使用简体中文，只输出 JSON。`

const MACRO_CYCLE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    cyclePhase: { type: 'STRING' },
    headline: { type: 'STRING' },
    transmission: { type: 'STRING' },
    historicalAnalogy: { type: 'STRING' },
    allocations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          asset: { type: 'STRING' },
          bias: { type: 'STRING', enum: ['bullish', 'bearish', 'neutral'] },
          rationale: { type: 'STRING' },
        },
        required: ['asset', 'bias', 'rationale'],
      },
    },
    riskNote: { type: 'STRING' },
  },
  required: ['cyclePhase', 'headline', 'transmission', 'historicalAnalogy', 'allocations', 'riskNote'],
}

export function localMacroCycleAnalysis(macro: MacroRates): MacroCycleAnalysis {
  const inverted = macro.us10y < macro.us2y
  const wideSpread = macro.spread10y > 0.5
  return {
    cyclePhase: inverted ? '曲线倒挂 · 晚周期防御' : '高利率平台期 · 利差博弈',
    headline: `美债 10Y (${macro.us10y.toFixed(2)}%) 领先 MGS 10Y (${macro.mgs10y.toFixed(2)}%) ${macro.spread10y.toFixed(2)}%`,
    transmission: `当前美国 2Y-10Y 利差为 ${((macro.us10y - macro.us2y) * 100).toFixed(0)} bp，BNM OPR 维持 ${macro.opr.toFixed(2)}%，美马 10Y 利差处于 ${macro.spread10y.toFixed(2)}% 区间。高贴现率仍压制高估值久期资产，同时${wideSpread ? '较宽的美马利差使令吉汇率与外资流向对美联储指引保持高敏感度。' : '收敛中的美马利差有助缓和令吉与马股的外部利率压力。'}`,
    historicalAnalogy:
      '参考 2022–2023 年紧缩平台期与 1997 亚洲汇率传导经验：利差走阔阶段宜重现金流与股息安全垫，待长端利率见顶后再加仓久期。',
    allocations: [
      { asset: '美股权益', bias: inverted ? 'neutral' : 'bullish', rationale: '高现金流龙头具备抗贴现率韧性，警惕高 PE 成长股估值波动' },
      { asset: '马股 Bursa', bias: wideSpread ? 'neutral' : 'bullish', rationale: '关注高股息银行与公用事业板块对冲外资利率波动' },
      { asset: '美债与 MGS', bias: 'bullish', rationale: '锁定 4%+ 票息收益，配置中长久期捕捉降息周期资本利得' },
      { asset: '黄金与避险', bias: 'bullish', rationale: '地缘不确定性与实际利率见顶预期支撑中枢上移' },
      { asset: '波动率与现金', bias: 'neutral', rationale: '保留适当美元/令吉流动性应对议息会议前后 IV 脉冲' },
    ],
    riskNote: '重点跟踪美债 10Y 突破前高与 BNM OPR 措辞变化对美元兑令吉（USD/MYR）的冲击。',
    generatedAt: new Date().toISOString(),
    model: 'local',
    degraded: true,
  }
}

export async function runMacroCycleAnalysis(
  macro: MacroRates,
  news: NewsArticle[],
  apiKey: string,
  route: AiRoute,
  signal?: AbortSignal,
): Promise<MacroCycleAnalysis> {
  const fallback = localMacroCycleAnalysis(macro)
  if (!apiKey?.trim() && !hasConfiguredBackupAi()) return fallback

  const topHeadlines = news
    .slice(0, 8)
    .map((item) => `- [${item.sourceName}] ${item.titleZh ?? item.title}`)
    .join('\n')

  const payload = [
    '=== 实时利率矩阵 ===',
    `US 2Y: ${macro.us2y.toFixed(2)}% | US 10Y: ${macro.us10y.toFixed(2)}% | US 30Y: ${macro.us30y.toFixed(2)}%`,
    `US 2Y-10Y 利差: ${((macro.us10y - macro.us2y) * 100).toFixed(0)} bp`,
    `MGS 3Y: ${macro.mgs3y.toFixed(2)}% | MGS 5Y: ${macro.mgs5y.toFixed(2)}% | MGS 10Y: ${macro.mgs10y.toFixed(2)}%`,
    `BNM OPR: ${macro.opr.toFixed(2)}%`,
    `US 10Y - MGS 10Y 利差: ${macro.spread10y.toFixed(2)}% (${(macro.spread10y * 100).toFixed(0)} bp)`,
    '',
    '=== 最新财经头条 ===',
    topHeadlines || '暂无实时头条',
  ].join('\n')

  try {
    const { text, model: usedModel } = await generateText({
      apiKey,
      route,
      systemInstruction: MACRO_CYCLE_INSTRUCTION,
      contents: [{ role: 'user', parts: [{ text: payload }] }],
      jsonSchema: MACRO_CYCLE_SCHEMA,
      temperature: 0.35,
      maxOutputTokens: 2560,
      signal,
    })
    const parsed = parseJsonBlock<Partial<MacroCycleAnalysis>>(text)
    const allocations = Array.isArray(parsed.allocations) && parsed.allocations.length > 0
      ? parsed.allocations.slice(0, 5).map((item) => ({
          asset: String(item.asset ?? '').trim() || '资产',
          bias: normalizeDirection(item.bias, 50),
          rationale: String(item.rationale ?? '').trim(),
        }))
      : fallback.allocations

    return {
      cyclePhase: (parsed.cyclePhase ?? '').trim() || fallback.cyclePhase,
      headline: (parsed.headline ?? '').trim() || fallback.headline,
      transmission: (parsed.transmission ?? '').trim() || fallback.transmission,
      historicalAnalogy: (parsed.historicalAnalogy ?? '').trim() || fallback.historicalAnalogy,
      allocations,
      riskNote: (parsed.riskNote ?? '').trim() || fallback.riskNote,
      generatedAt: new Date().toISOString(),
      model: usedModel,
      degraded: false,
    }
  } catch (error) {
    if (signal?.aborted) throw error
    return fallback
  }
}

export { inferRelayFromModel, localVerdict }

