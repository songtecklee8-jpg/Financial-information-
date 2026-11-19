import type { ServerKeys } from './env.js'

export type BackupProviderId = 'groq' | 'openrouter' | 'mistral' | 'cloudflare' | 'nvidia'
export type AllAiProviderId = 'gemini' | BackupProviderId
export type AiTaskTier = 'lite' | 'flash' | 'pro'

export interface ServerAiBackupKeys {
  enabled?: boolean
  groq?: string
  openrouter?: string
  mistral?: string
  cloudflareAccountId?: string
  cloudflareApiToken?: string
  nvidia?: string
}

export interface BackupGenerateRequest {
  system: string
  prompt: string
  tier: AiTaskTier
  temperature?: number
  maxOutputTokens?: number
  expectJson?: boolean
  keys?: ServerAiBackupKeys
  /** 并发分流时按轮询偏移分散请求，故障兜底时按优先级顺序尝试 */
  rotate?: boolean
  /** 显式消息历史（供对话代理使用） */
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
}

export interface BackupGeneration {
  text: string
  model: string
  provider: BackupProviderId
}

// ---------------------------------------------------------------------------
// 熔断与并发追踪（单实例内存态：429 / 连续失败自动临时冷却）
// ---------------------------------------------------------------------------

interface CircuitState {
  failures: number
  cooldownUntil: number
  lastError?: string
}

const circuits = new Map<AllAiProviderId, CircuitState>()
let inFlightGemini = 0
let roundRobinCursor = 0

export const MAX_GEMINI_CONCURRENCY = 2
const TIMEOUT_MS = 35_000

export function enterGeminiSlot(): void {
  inFlightGemini += 1
}

export function leaveGeminiSlot(): void {
  inFlightGemini = Math.max(0, inFlightGemini - 1)
}

export function getInFlightGeminiCount(): number {
  return inFlightGemini
}

export function isProviderCoolingDown(id: AllAiProviderId): boolean {
  const state = circuits.get(id)
  if (!state) return false
  if (state.cooldownUntil > Date.now()) return true
  if (state.cooldownUntil > 0) {
    state.cooldownUntil = 0
  }
  return false
}

export function recordProviderSuccess(id: AllAiProviderId): void {
  circuits.set(id, { failures: 0, cooldownUntil: 0 })
}

export function recordProviderFailure(id: AllAiProviderId, status?: number, message = ''): void {
  const prev = circuits.get(id) ?? { failures: 0, cooldownUntil: 0 }
  const failures = prev.failures + 1
  const isRateLimit = status === 429 || /rate.?limit|quota|too many requests|resource_exhausted/i.test(message)
  const isAuthError = status === 401 || status === 403 || /invalid.*key|unauthorized/i.test(message)

  let cooldownMs = 0
  if (isAuthError) cooldownMs = 300_000
  else if (isRateLimit) cooldownMs = 60_000
  else if (failures >= 2) cooldownMs = 120_000

  circuits.set(id, {
    failures,
    cooldownUntil: cooldownMs > 0 ? Date.now() + cooldownMs : 0,
    lastError: message.slice(0, 120),
  })
}

// ---------------------------------------------------------------------------
// 密钥合并与可用性判断
// ---------------------------------------------------------------------------

function cleanStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function extractEnvBackupKeys(env: ServerKeys): ServerAiBackupKeys {
  return {
    enabled: true,
    groq: env.groq,
    openrouter: env.openrouter,
    mistral: env.mistral,
    cloudflareAccountId: env.cloudflareAccountId,
    cloudflareApiToken: env.cloudflareApiToken,
    nvidia: env.nvidia,
  }
}

export function mergeBackupKeys(env: ServerKeys, rawClient?: unknown): ServerAiBackupKeys {
  const client =
    rawClient && typeof rawClient === 'object' ? (rawClient as Record<string, unknown>) : {}
  return {
    enabled: client.enabled === false ? false : true,
    groq: cleanStr(client.groqKey) || env.groq,
    openrouter: cleanStr(client.openrouterKey) || env.openrouter,
    mistral: cleanStr(client.mistralKey) || env.mistral,
    cloudflareAccountId: cleanStr(client.cloudflareAccountId) || env.cloudflareAccountId,
    cloudflareApiToken: cleanStr(client.cloudflareApiToken) || env.cloudflareApiToken,
    nvidia: cleanStr(client.nvidiaKey) || env.nvidia,
  }
}

export function isBackupConfigured(id: BackupProviderId, keys?: ServerAiBackupKeys): boolean {
  if (!keys) return false
  switch (id) {
    case 'groq':
      return Boolean(cleanStr(keys.groq))
    case 'openrouter':
      return Boolean(cleanStr(keys.openrouter))
    case 'mistral':
      return Boolean(cleanStr(keys.mistral))
    case 'cloudflare':
      return Boolean(cleanStr(keys.cloudflareAccountId) && cleanStr(keys.cloudflareApiToken))
    case 'nvidia':
      return Boolean(cleanStr(keys.nvidia))
  }
}

export function listConfiguredBackups(keys?: ServerAiBackupKeys): BackupProviderId[] {
  if (!keys || keys.enabled === false) return []
  const order: BackupProviderId[] = ['groq', 'openrouter', 'mistral', 'cloudflare', 'nvidia']
  return order.filter((id) => isBackupConfigured(id, keys))
}

export function hasConfiguredBackup(keys?: ServerAiBackupKeys): boolean {
  return listConfiguredBackups(keys).length > 0
}

export function shouldOffloadGemini(keys?: ServerAiBackupKeys): boolean {
  return inFlightGemini >= MAX_GEMINI_CONCURRENCY && hasConfiguredBackup(keys)
}

export function inferTierFromModel(model?: string): AiTaskTier {
  const m = (model ?? '').toLowerCase()
  if (m.includes('lite')) return 'lite'
  if (m.includes('pro')) return 'pro'
  return 'flash'
}

// ---------------------------------------------------------------------------
// 5 家永久免费服务商端点与分层模型配置
// ---------------------------------------------------------------------------

interface ProviderSpec {
  id: BackupProviderId
  models: Record<AiTaskTier, string[]>
  supportsJsonFormat: boolean
  endpoint: (keys: ServerAiBackupKeys) => string
  headers: (keys: ServerAiBackupKeys) => Record<string, string>
}

const PROVIDER_SPECS: Record<BackupProviderId, ProviderSpec> = {
  groq: {
    id: 'groq',
    models: {
      lite: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
      flash: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
      pro: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    },
    supportsJsonFormat: true,
    endpoint: () => 'https://api.groq.com/openai/v1/chat/completions',
    headers: (keys) => ({
      Authorization: `Bearer ${cleanStr(keys.groq)}`,
      'Content-Type': 'application/json',
    }),
  },
  openrouter: {
    id: 'openrouter',
    models: {
      lite: ['meta-llama/llama-3.3-70b-instruct:free', 'openrouter/free'],
      flash: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemma-3-27b-it:free', 'openrouter/free'],
      pro: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemma-3-27b-it:free', 'openrouter/free'],
    },
    supportsJsonFormat: false,
    endpoint: () => 'https://openrouter.ai/api/v1/chat/completions',
    headers: (keys) => ({
      Authorization: `Bearer ${cleanStr(keys.openrouter)}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://apex-terminal.local',
      'X-Title': 'APEX Terminal',
    }),
  },
  mistral: {
    id: 'mistral',
    models: {
      lite: ['mistral-small-latest', 'open-mistral-nemo'],
      flash: ['mistral-small-latest', 'open-mistral-nemo'],
      pro: ['mistral-small-latest', 'open-mistral-nemo'],
    },
    supportsJsonFormat: true,
    endpoint: () => 'https://api.mistral.ai/v1/chat/completions',
    headers: (keys) => ({
      Authorization: `Bearer ${cleanStr(keys.mistral)}`,
      'Content-Type': 'application/json',
    }),
  },
  cloudflare: {
    id: 'cloudflare',
    models: {
      lite: ['@cf/meta/llama-3.1-8b-instruct-fast', '@cf/meta/llama-3.1-8b-instruct'],
      flash: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'],
      pro: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'],
    },
    supportsJsonFormat: false,
    endpoint: (keys) =>
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        cleanStr(keys.cloudflareAccountId),
      )}/ai/v1/chat/completions`,
    headers: (keys) => ({
      Authorization: `Bearer ${cleanStr(keys.cloudflareApiToken)}`,
      'Content-Type': 'application/json',
    }),
  },
  nvidia: {
    id: 'nvidia',
    models: {
      lite: ['meta/llama-3.1-8b-instruct', 'meta/llama-3.3-70b-instruct'],
      flash: ['meta/llama-3.3-70b-instruct', 'meta/llama-3.1-8b-instruct'],
      pro: ['meta/llama-3.3-70b-instruct', 'qwen/qwen2.5-72b-instruct'],
    },
    supportsJsonFormat: false,
    endpoint: () => 'https://integrate.api.nvidia.com/v1/chat/completions',
    headers: (keys) => ({
      Authorization: `Bearer ${cleanStr(keys.nvidia)}`,
      'Content-Type': 'application/json',
    }),
  },
}

const TIER_PRIORITY: Record<AiTaskTier, BackupProviderId[]> = {
  lite: ['groq', 'cloudflare', 'mistral', 'openrouter', 'nvidia'],
  flash: ['groq', 'openrouter', 'mistral', 'nvidia', 'cloudflare'],
  pro: ['openrouter', 'nvidia', 'mistral', 'groq', 'cloudflare'],
}

function buildMessages(req: BackupGenerateRequest): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const jsonHint = req.expectJson
    ? '\n\n[STRICT OUTPUT] 只输出合法 JSON 对象，禁止使用 Markdown 代码块之外的多余解释文字。'
    : ''
  if (req.messages && req.messages.length > 0) {
    return [
      ...(req.system ? [{ role: 'system' as const, content: `${req.system}${jsonHint}` }] : []),
      ...req.messages,
    ]
  }
  return [
    { role: 'system', content: `${req.system}${jsonHint}` },
    { role: 'user', content: req.prompt },
  ]
}

async function callSingleProviderModel(
  spec: ProviderSpec,
  keys: ServerAiBackupKeys,
  model: string,
  req: BackupGenerateRequest,
): Promise<string> {
  const send = async (withJsonFormat: boolean): Promise<string> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const body: Record<string, unknown> = {
        model,
        messages: buildMessages(req),
        temperature: req.temperature ?? 0.3,
        max_tokens: Math.min(req.maxOutputTokens ?? 3072, 4096),
      }
      if (withJsonFormat && req.expectJson && spec.supportsJsonFormat) {
        body.response_format = { type: 'json_object' }
      }
      const response = await fetch(spec.endpoint(keys), {
        method: 'POST',
        headers: spec.headers(keys),
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        const err = new Error(`${spec.id} HTTP ${response.status} ${detail.slice(0, 160)}`)
        ;(err as Error & { status?: number }).status = response.status
        throw err
      }
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        result?: { response?: string }
      }
      const content =
        json.choices?.[0]?.message?.content ?? json.result?.response ?? ''
      if (!content.trim()) throw new Error(`${spec.id} 返回空结果`)
      return content
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    return await send(true)
  } catch (error) {
    const status = (error as { status?: number }).status
    // 部分模型不支持 response_format=json_object 时自动剥除重发
    if (status === 400 && req.expectJson && spec.supportsJsonFormat) {
      return await send(false)
    }
    throw error
  }
}

export async function callBackupProvider(
  providerId: BackupProviderId,
  req: BackupGenerateRequest,
): Promise<BackupGeneration> {
  const keys = req.keys
  if (!keys || !isBackupConfigured(providerId, keys)) {
    throw new Error(`${providerId} 未配置 API Key`)
  }
  const spec = PROVIDER_SPECS[providerId]
  const models = spec.models[req.tier]
  let lastError: unknown = null

  for (const model of models) {
    try {
      const text = await callSingleProviderModel(spec, keys, model, req)
      recordProviderSuccess(providerId)
      return {
        text,
        model: `${providerId}/${model}`,
        provider: providerId,
      }
    } catch (error) {
      lastError = error
      const status = (error as { status?: number }).status
      const msg = error instanceof Error ? error.message : String(error)
      recordProviderFailure(providerId, status, msg)
      if (status === 401 || status === 403 || status === 429) break
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${providerId} 调用失败`)
}

/**
 * 依次尝试所有健康的已配置免费备用服务商；并发分流时按游标轮询负载均衡。
 */
export async function callBackupProvidersServer(
  req: BackupGenerateRequest,
): Promise<BackupGeneration> {
  const keys = req.keys
  if (!keys || keys.enabled === false) {
    throw new Error('备用 AI 兜底已关闭')
  }

  const configured = TIER_PRIORITY[req.tier].filter((id) => isBackupConfigured(id, keys))
  if (configured.length === 0) {
    throw new Error('未配置任何免费备用 AI 服务商 Key')
  }

  const healthy = configured.filter((id) => !isProviderCoolingDown(id))
  const candidates = healthy.length > 0 ? healthy : configured

  let ordered = candidates
  if (req.rotate && candidates.length > 1) {
    const shift = roundRobinCursor % candidates.length
    roundRobinCursor = (roundRobinCursor + 1) % candidates.length
    ordered = [...candidates.slice(shift), ...candidates.slice(0, shift)]
  }

  let lastError: unknown = null
  for (const providerId of ordered) {
    try {
      return await callBackupProvider(providerId, req)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('全部免费备用 AI 服务商均不可用')
}

export async function testBackupProviderServer(
  providerId: BackupProviderId,
  keys: ServerAiBackupKeys,
): Promise<{ ok: boolean; model?: string; message?: string }> {
  try {
    const res = await callBackupProvider(providerId, {
      system: 'Reply with OK only.',
      prompt: 'Ping',
      tier: 'lite',
      maxOutputTokens: 16,
      temperature: 0,
      keys,
    })
    return { ok: true, model: res.model }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
