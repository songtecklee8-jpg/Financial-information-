/**
 * APEX Terminal — 服务端 AI 统一路由与兜底引擎。
 *
 * 1. 保持 Gemini 为绝对主力（Pro → Flash → Flash-Lite → gemini-flash-latest 原有降级链不变）。
 * 2. 仅当 Gemini 触发 429 限流 / 配额耗尽 / 超时报错 / 未配置 Key，或在多任务高并发排队时，
 *    自动由已配置的永久免费备用服务商（Groq / OpenRouter / Mistral / Cloudflare / NVIDIA）接力顶上，
 *    并在单家连续失败时做临时冷却熔断。
 */

import {
  type ServerAiBackupKeys,
  callBackupProvidersServer,
  enterGeminiSlot,
  hasConfiguredBackup,
  inferTierFromModel,
  isProviderCoolingDown,
  leaveGeminiSlot,
  recordProviderFailure,
  recordProviderSuccess,
  shouldOffloadGemini,
} from './aiProviders.js'

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models'

/** 后台默认使用的轻量模型（高频批量任务） */
export const SERVER_LITE_MODEL = 'gemini-2.5-flash-lite'

/** 交互研判用的均衡模型（单篇深度摘要 / 推演） */
export const SERVER_FLASH_MODEL = 'gemini-2.5-flash'

/** 深度推理模型 */
export const SERVER_PRO_MODEL = 'gemini-2.5-pro'

const LAST_RESORT_MODEL = 'gemini-flash-latest'

const TIMEOUT_MS = 45_000

export interface GenerateServerOptions {
  apiKey: string
  /** 目标模型（失败后按 chain 自动降级） */
  model?: string
  /** 完整降级链；不传则由 model 派生 */
  chain?: string[]
  system: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  responseSchema?: unknown
  /** 可选永久免费备用服务商凭证与开关 */
  backupKeys?: ServerAiBackupKeys
  /** 批量/并发场景下当 Gemini 并发已满时允许把后续子任务分流到健康备用引擎 */
  allowConcurrencyOffload?: boolean
}

export interface ServerGeneration {
  text: string
  model: string
}

function deriveChain(model: string): string[] {
  const chain = [model]
  if (model.includes('2.5-pro')) chain.push(SERVER_FLASH_MODEL, SERVER_LITE_MODEL)
  else if (model.includes('2.5-flash') && !model.includes('lite')) chain.push(SERVER_LITE_MODEL)
  chain.push(LAST_RESORT_MODEL)
  return Array.from(new Set(chain))
}

/** 从模型返回的文本中稳健地抽出 JSON（兼容 ```json 围栏与前后缀说明） */
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

async function callModel(
  options: GenerateServerOptions,
  model: string,
): Promise<ServerGeneration> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const body = {
    systemInstruction: { parts: [{ text: options.system }] },
    contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
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
      `${API_ROOT}/${model}:generateContent?key=${encodeURIComponent(options.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    )
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const error = new Error(`Gemini HTTP ${response.status} ${detail.slice(0, 160)}`)
      ;(error as Error & { status?: number }).status = response.status
      throw error
    }
    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? ''
    if (!text.trim()) throw new Error('Gemini 返回空结果')
    return { text, model }
  } finally {
    clearTimeout(timer)
  }
}

async function callGeminiChain(options: GenerateServerOptions): Promise<ServerGeneration> {
  const chain = options.chain ?? deriveChain(options.model ?? SERVER_LITE_MODEL)
  let lastError: unknown = null
  enterGeminiSlot()
  try {
    for (const model of chain) {
      try {
        const res = await callModel(options, model)
        recordProviderSuccess('gemini')
        return res
      } catch (error) {
        lastError = error
        const status = (error as { status?: number }).status
        const message = error instanceof Error ? error.message : String(error)
        recordProviderFailure('gemini', status, message)
        if (status === 400 || status === 401 || status === 403) break
      }
    }
  } finally {
    leaveGeminiSlot()
  }
  throw lastError instanceof Error ? lastError : new Error('Gemini 全部模型均不可用')
}

/**
 * 统一 AI 调用入口：
 * 1) 默认优先走 Gemini 完整降级链；
 * 2) Gemini 限流 / 报错 / 冷却 / 未配置 / 高并发排队时，自动转入永久免费备用服务商；
 * 3) 全部不可用时抛出错误由调用方平稳降级到本地引擎。
 */
export async function generateServer(options: GenerateServerOptions): Promise<ServerGeneration> {
  const hasGemini = Boolean(options.apiKey?.trim())
  const backupsReady = hasConfiguredBackup(options.backupKeys)
  const tier = inferTierFromModel(options.model)
  const offloadForConcurrency = Boolean(
    options.allowConcurrencyOffload && shouldOffloadGemini(options.backupKeys),
  )

  if (!hasGemini && !backupsReady) {
    throw new Error('未配置 GEMINI_API_KEY 或任何备用 AI Key')
  }

  const shouldTryGeminiFirst =
    hasGemini && (!backupsReady || (!isProviderCoolingDown('gemini') && !offloadForConcurrency))

  if (shouldTryGeminiFirst) {
    try {
      return await callGeminiChain(options)
    } catch (geminiError) {
      if (!backupsReady) throw geminiError
    }
  }

  if (backupsReady) {
    try {
      const backupRes = await callBackupProvidersServer({
        system: options.system,
        prompt: options.prompt,
        tier,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        expectJson: Boolean(options.responseSchema),
        keys: options.backupKeys,
        rotate: offloadForConcurrency || isProviderCoolingDown('gemini'),
      })
      return { text: backupRes.text, model: backupRes.model }
    } catch (backupError) {
      // 若最初因并发/临时冷却跳过 Gemini 但所有备用均失败，再做一次 Gemini 兜底尝试
      if (hasGemini && !shouldTryGeminiFirst) {
        return await callGeminiChain(options)
      }
      throw backupError
    }
  }

  return await callGeminiChain(options)
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

