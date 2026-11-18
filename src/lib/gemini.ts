import type { AiVerdict, ChatMessage, Verdict } from '@/types'
import {
  VERDICT_INSTRUCTION,
  buildChatContextBlock,
  buildChatSystemInstruction,
  buildVerdictPayload,
  localVerdict,
  type AiContextInput,
} from '@/lib/aiContext'

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

export { localVerdict }
