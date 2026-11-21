/**
 * APEX Research — 服务端 AI 统一“接力赛”自动容错引擎。
 *
 * 严格接力顺序（第 1 棒 → 第 10 棒）：
 * - 第 1 棒：Google Gemini（优先 gemini-2.5-flash / gemini-2.5-pro，支持多把 Gemini Key 内部轮询）
 * - 第 2 棒：Groq
 * - 第 3 棒：OpenRouter
 * - 第 4 棒：Cerebras
 * - 第 5 棒：NVIDIA NIM
 * - 第 6 棒：Cloudflare Workers AI
 * - 第 7 棒：Mistral
 * - 第 8 棒：Cohere
 * - 第 9 棒：自定义 OpenAI 兼容槽位 1
 * - 第 10 棒：自定义 OpenAI 兼容槽位 2
 */

import {
  type AllAiProviderId,
  BATON_META,
  type ServerAiBackupKeys,
  callBackupProvidersServer,
  enterGeminiSlot,
  hasConfiguredBackup,
  inferTierFromModel,
  leaveGeminiSlot,
  recordProviderFailure,
  recordProviderSuccess,
} from './aiProviders.js'

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models'

export const SERVER_LITE_MODEL = 'gemini-2.5-flash-lite'
export const SERVER_FLASH_MODEL = 'gemini-2.5-flash'
export const SERVER_PRO_MODEL = 'gemini-2.5-pro'
const LAST_RESORT_MODEL = 'gemini-flash-latest'

const TIMEOUT_MS = 38_000

export interface GenerateServerOptions {
  /** 主 Gemini Key（兼容旧调用方） */
  apiKey?: string
  /** 多把 Gemini Key 列表，在 Gemini 第 1 棒内部依次轮询 */
  apiKeys?: string[]
  /** 目标模型（失败后按 chain 自动降级） */
  model?: string
  /** 完整降级链；不传则由 model 派生 */
  chain?: string[]
  system: string
  prompt: string
  /** 可选多轮对话历史 */
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature?: number
  maxOutputTokens?: number
  responseSchema?: unknown
  /** 第 2-10 棒备用通道凭证 */
  backupKeys?: ServerAiBackupKeys
  allowConcurrencyOffload?: boolean
}

export interface ServerGeneration {
  text: string
  model: string
  provider: AllAiProviderId
  providerName: string
  baton: number
}

function deriveChain(model: string): string[] {
  const chain: string[] = []
  const push = (m: string) => {
    if (m && !chain.includes(m)) chain.push(m)
  }
  push(model)
  if (model.includes('2.5-pro')) {
    push(SERVER_FLASH_MODEL)
    push(SERVER_LITE_MODEL)
  } else if (model.includes('2.5-flash') && !model.includes('lite')) {
    push(SERVER_PRO_MODEL)
    push(SERVER_LITE_MODEL)
  } else {
    push(SERVER_FLASH_MODEL)
    push(SERVER_PRO_MODEL)
  }
  push(LAST_RESORT_MODEL)
  return chain
}

/** 从模型返回的文本中稳健地抽出 JSON */
export function parseJsonLoose<T>(text: string): T | null {
  if (!text) return null
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = (fenced ? fenced[1] : text).trim()
  try {
    return JSON.parse(candidate) as T
  } catch {
    const start = candidate.search(/[[{]/)
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T
      } catch {
        return null
      }
    }
    return null
  }
}

async function callGeminiModelWithKey(
  options: GenerateServerOptions,
  geminiKey: string,
  model: string,
): Promise<ServerGeneration> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const contents =
    options.messages && options.messages.length > 0
      ? options.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }))
      : [{ role: 'user', parts: [{ text: options.prompt }] }]

  const body: Record<string, unknown> = {
    ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.35,
      maxOutputTokens: options.maxOutputTokens ?? 4096,
      ...(options.responseSchema
        ? { responseMimeType: 'application/json', responseSchema: options.responseSchema }
        : {}),
    },
  }
  try {
    const response = await fetch(
      `${API_ROOT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    )
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const error = new Error(`Gemini HTTP ${response.status} ${detail.slice(0, 180)}`)
      ;(error as Error & { status?: number }).status = response.status
      throw error
    }
    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? ''
    if (!text.trim()) throw new Error('Gemini 返回空结果')
    return {
      text,
      model,
      provider: 'gemini',
      providerName: BATON_META.gemini.name,
      baton: BATON_META.gemini.baton,
    }
  } finally {
    clearTimeout(timer)
  }
}

function collectKeyList(options: GenerateServerOptions): string[] {
  const raw = [...(options.apiKeys ?? []), ...(options.apiKey ? [options.apiKey] : [])]
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const clean = (item ?? '').trim()
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
  }
  return out
}

async function callGeminiRelayBaton(options: GenerateServerOptions): Promise<ServerGeneration> {
  const keys = collectKeyList(options)
  if (keys.length === 0) throw new Error('未配置 Gemini API Key')
  const chain = options.chain ?? deriveChain(options.model ?? SERVER_FLASH_MODEL)
  let lastError: unknown = null

  enterGeminiSlot()
  try {
    // 内部轮询所有可用 Gemini Key，每把 Key 先试首选模型再降级模型链
    for (const key of keys) {
      for (const model of chain) {
        try {
          const res = await callGeminiModelWithKey(options, key, model)
          recordProviderSuccess('gemini')
          return res
        } catch (error) {
          lastError = error
          const status = (error as { status?: number }).status
          const message = error instanceof Error ? error.message : String(error)
          recordProviderFailure('gemini', status, message)
          // 该把 Key 限流(429)或无效(400/401/403)时立即切换下一把 Gemini Key
          if (status === 400 || status === 401 || status === 403 || status === 429) break
        }
      }
    }
  } finally {
    leaveGeminiSlot()
  }
  throw lastError instanceof Error ? lastError : new Error('Gemini 全部密钥及模型均不可用')
}

export async function testGeminiServer(
  geminiKeys: string[],
): Promise<{ ok: boolean; model?: string; providerName?: string; baton?: number; message?: string }> {
  try {
    const res = await callGeminiRelayBaton({
      apiKeys: geminiKeys,
      model: SERVER_FLASH_MODEL,
      chain: [SERVER_FLASH_MODEL, SERVER_LITE_MODEL],
      system: 'Reply with OK only.',
      prompt: 'Ping',
      maxOutputTokens: 16,
      temperature: 0,
    })
    return {
      ok: true,
      model: res.model,
      providerName: res.providerName,
      baton: res.baton,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 严格按第 1 棒 (Gemini 多 Key 轮询) → 第 2~10 棒 (Groq→OpenRouter→Cerebras→NVIDIA→Cloudflare→Mistral→Cohere→自定义1/2) 顺序接力。
 */
export async function generateServer(options: GenerateServerOptions): Promise<ServerGeneration> {
  const geminiKeys = collectKeyList(options)
  const hasGemini = geminiKeys.length > 0
  const backupsReady = hasConfiguredBackup(options.backupKeys)
  const tier = inferTierFromModel(options.model)

  if (!hasGemini && !backupsReady) {
    throw new Error('未配置 Gemini 或任何接力赛 AI Key')
  }

  // 第 1 棒永远绝对优先尝试 Google Gemini
  if (hasGemini) {
    try {
      return await callGeminiRelayBaton(options)
    } catch (geminiError) {
      if (!backupsReady) throw geminiError
    }
  }

  // 第 1 棒限流/报错/超时/未配置时，立刻无缝接力第 2~10 棒
  const backupRes = await callBackupProvidersServer({
    system: options.system,
    prompt: options.prompt,
    messages: options.messages,
    tier,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
    expectJson: Boolean(options.responseSchema),
    keys: options.backupKeys,
  })
  return {
    text: backupRes.text,
    model: backupRes.model,
    provider: backupRes.provider,
    providerName: backupRes.providerName,
    baton: backupRes.baton,
  }
}

export function resolveServerModel(
  defaultTier: 'lite' | 'flash' | 'pro',
  aiRouting?: string,
  customModel?: string,
): string {
  const override = (customModel ?? '').trim()
  if (override) return override
  if (aiRouting === 'pro') return SERVER_PRO_MODEL
  if (aiRouting === 'flash') return SERVER_FLASH_MODEL
  if (aiRouting === 'lite') return SERVER_LITE_MODEL
  if (defaultTier === 'pro') return SERVER_PRO_MODEL
  if (defaultTier === 'lite') return SERVER_LITE_MODEL
  return SERVER_FLASH_MODEL
}
