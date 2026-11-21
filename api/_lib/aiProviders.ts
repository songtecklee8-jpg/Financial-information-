import type { ServerKeys } from './env.js'

export type BackupProviderId =
  | 'groq'
  | 'openrouter'
  | 'cerebras'
  | 'nvidia'
  | 'cloudflare'
  | 'mistral'
  | 'cohere'
  | 'custom1'
  | 'custom2'

export type AllAiProviderId = 'gemini' | BackupProviderId
export type AiTaskTier = 'lite' | 'flash' | 'pro'

export const RELAY_ORDER: BackupProviderId[] = [
  'groq',
  'openrouter',
  'cerebras',
  'nvidia',
  'cloudflare',
  'mistral',
  'cohere',
  'custom1',
  'custom2',
]

export const BATON_META: Record<AllAiProviderId, { baton: number; name: string }> = {
  gemini: { baton: 1, name: 'Google Gemini' },
  groq: { baton: 2, name: 'Groq' },
  openrouter: { baton: 3, name: 'OpenRouter' },
  cerebras: { baton: 4, name: 'Cerebras' },
  nvidia: { baton: 5, name: 'NVIDIA NIM' },
  cloudflare: { baton: 6, name: 'Cloudflare Workers AI' },
  mistral: { baton: 7, name: 'Mistral' },
  cohere: { baton: 8, name: 'Cohere' },
  custom1: { baton: 9, name: '自定义 OpenAI #1' },
  custom2: { baton: 10, name: '自定义 OpenAI #2' },
}

export interface ServerAiBackupKeys {
  enabled?: boolean
  groq?: string
  openrouter?: string
  cerebras?: string
  nvidia?: string
  cloudflareAccountId?: string
  cloudflareApiToken?: string
  mistral?: string
  cohere?: string
  custom1Url?: string
  custom1Key?: string
  custom1Model?: string
  custom2Url?: string
  custom2Key?: string
  custom2Model?: string
}

export interface BackupGenerateRequest {
  system: string
  prompt: string
  tier: AiTaskTier
  temperature?: number
  maxOutputTokens?: number
  expectJson?: boolean
  keys?: ServerAiBackupKeys
  /** 并发分流时按轮询偏移分散请求，常规接力严格按第 2→10 棒顺序 */
  rotate?: boolean
  /** 显式消息历史（供多轮对话与 CFA 跟课问答使用） */
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
}

export interface BackupGeneration {
  text: string
  model: string
  provider: BackupProviderId
  providerName: string
  baton: number
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

export const MAX_GEMINI_CONCURRENCY = 2
const TIMEOUT_MS = 32_000

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
  if (state.cooldownUntil > 0) state.cooldownUntil = 0
  return false
}

export function recordProviderSuccess(id: AllAiProviderId): void {
  circuits.set(id, { failures: 0, cooldownUntil: 0 })
}

export function recordProviderFailure(id: AllAiProviderId, status?: number, message = ''): void {
  const prev = circuits.get(id) ?? { failures: 0, cooldownUntil: 0 }
  const failures = prev.failures + 1
  const isRateLimit =
    status === 429 || /rate.?limit|quota|too many requests|resource_exhausted/i.test(message)
  const isAuthError = status === 401 || status === 403 || /invalid.*key|unauthorized/i.test(message)

  let cooldownMs = 0
  if (isAuthError) cooldownMs = 180_000
  else if (isRateLimit) cooldownMs = 45_000
  else if (failures >= 2) cooldownMs = 60_000

  circuits.set(id, {
    failures,
    cooldownUntil: cooldownMs > 0 ? Date.now() + cooldownMs : 0,
    lastError: message.slice(0, 120),
  })
}

// ---------------------------------------------------------------------------
// 密钥合并与可用性判断（服务端 Vercel Env 优先，本地 localStorage 兜底）
// ---------------------------------------------------------------------------

function cleanStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function collectMergedGeminiKeys(env: ServerKeys, rawClient?: unknown, singleGeminiKey?: unknown): string[] {
  const client =
    rawClient && typeof rawClient === 'object' ? (rawClient as Record<string, unknown>) : {}
  const candidates = [
    ...env.geminiKeys,
    cleanStr(singleGeminiKey),
    cleanStr(client.geminiKey),
    cleanStr(client.geminiKey2),
    cleanStr(client.geminiKey3),
  ]
  const out: string[] = []
  const seen = new Set<string>()
  for (const key of candidates) {
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

export function extractEnvBackupKeys(env: ServerKeys): ServerAiBackupKeys {
  return {
    enabled: true,
    groq: env.groq,
    openrouter: env.openrouter,
    cerebras: env.cerebras,
    nvidia: env.nvidia,
    cloudflareAccountId: env.cloudflareAccountId,
    cloudflareApiToken: env.cloudflareApiToken,
    mistral: env.mistral,
    cohere: env.cohere,
    custom1Url: env.custom1Url,
    custom1Key: env.custom1Key,
    custom1Model: env.custom1Model,
    custom2Url: env.custom2Url,
    custom2Key: env.custom2Key,
    custom2Model: env.custom2Model,
  }
}

/** 服务端环境变量优先；未配置对应环境变量时使用客户端传入 Key 经服务端转发 */
export function mergeBackupKeys(env: ServerKeys, rawClient?: unknown): ServerAiBackupKeys {
  const client =
    rawClient && typeof rawClient === 'object' ? (rawClient as Record<string, unknown>) : {}
  return {
    enabled: client.enabled === false ? false : true,
    groq: env.groq || cleanStr(client.groqKey),
    openrouter: env.openrouter || cleanStr(client.openrouterKey),
    cerebras: env.cerebras || cleanStr(client.cerebrasKey),
    nvidia: env.nvidia || cleanStr(client.nvidiaKey),
    cloudflareAccountId: env.cloudflareAccountId || cleanStr(client.cloudflareAccountId),
    cloudflareApiToken: env.cloudflareApiToken || cleanStr(client.cloudflareApiToken),
    mistral: env.mistral || cleanStr(client.mistralKey),
    cohere: env.cohere || cleanStr(client.cohereKey),
    custom1Url: env.custom1Url || cleanStr(client.custom1Url),
    custom1Key: env.custom1Key || cleanStr(client.custom1Key),
    custom1Model: env.custom1Model || cleanStr(client.custom1Model),
    custom2Url: env.custom2Url || cleanStr(client.custom2Url),
    custom2Key: env.custom2Key || cleanStr(client.custom2Key),
    custom2Model: env.custom2Model || cleanStr(client.custom2Model),
  }
}

export function normalizeOpenAiEndpoint(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) return ''
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  if (/\/(v1|v1beta\/openai|openai)$/i.test(trimmed)) return `${trimmed}/chat/completions`
  return `${trimmed}/v1/chat/completions`
}

export function isBackupConfigured(id: BackupProviderId, keys?: ServerAiBackupKeys): boolean {
  if (!keys) return false
  switch (id) {
    case 'groq':
      return Boolean(cleanStr(keys.groq))
    case 'openrouter':
      return Boolean(cleanStr(keys.openrouter))
    case 'cerebras':
      return Boolean(cleanStr(keys.cerebras))
    case 'nvidia':
      return Boolean(cleanStr(keys.nvidia))
    case 'cloudflare':
      return Boolean(cleanStr(keys.cloudflareAccountId) && cleanStr(keys.cloudflareApiToken))
    case 'mistral':
      return Boolean(cleanStr(keys.mistral))
    case 'cohere':
      return Boolean(cleanStr(keys.cohere))
    case 'custom1':
      return Boolean(normalizeOpenAiEndpoint(cleanStr(keys.custom1Url)) && cleanStr(keys.custom1Key))
    case 'custom2':
      return Boolean(normalizeOpenAiEndpoint(cleanStr(keys.custom2Url)) && cleanStr(keys.custom2Key))
  }
}

export function listConfiguredBackups(keys?: ServerAiBackupKeys): BackupProviderId[] {
  if (!keys || keys.enabled === false) return []
  return RELAY_ORDER.filter((id) => isBackupConfigured(id, keys))
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
// 第 2棒 – 第 10棒 端点与模型配置
// ---------------------------------------------------------------------------

interface ProviderSpec {
  id: BackupProviderId
  protocol: 'openai' | 'cohere'
  models: (keys: ServerAiBackupKeys, tier: AiTaskTier) => string[]
  supportsJsonFormat: boolean
  endpoint: (keys: ServerAiBackupKeys) => string
  headers: (keys: ServerAiBackupKeys) => Record<string, string>
}

const PROVIDER_SPECS: Record<BackupProviderId, ProviderSpec> = {
  groq: {
    id: 'groq',
    protocol: 'openai',
    models: (_k, tier) =>
      tier === 'lite'
        ? ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b']
        : ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
    supportsJsonFormat: true,
    endpoint: () => 'https://api.groq.com/openai/v1/chat/completions',
    headers: (keys) => ({
      Authorization: `Bearer ${cleanStr(keys.groq)}`,
      'Content-Type': 'application/json',
    }),
  },
  openrouter: {
    id: 'openrouter',
    protocol: 'openai',
    models: () => [
      'openrouter/free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemma-3-27b-it:free',
      'deepseek/deepseek-r1:free',
    ],
    supportsJsonFormat: false,
    endpoint: () => 'https://openrouter.ai/api/v1/chat/completions',
    headers: (keys) => ({
      Authorization: `Bearer ${cleanStr(keys.openrouter)}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://apex-research.local',
      'X-Title': 'APEX Research',
    }),
  },
  cerebras: {
    id: 'cerebras',
    protocol: 'openai',
    models: () => ['llama-3.3-70b', 'qwen-3-32b', 'llama3.1-8b'],
    supportsJsonFormat: true,
    endpoint: () => 'https://api.cerebras.ai/v1/chat/completions',
    headers: (keys) => ({
      Authorization: `Bearer ${cleanStr(keys.cerebras)}`,
      'Content-Type': 'application/json',
    }),
  },
  nvidia: {
    id: 'nvidia',
    protocol: 'openai',
    models: (_k, tier) =>
      tier === 'lite'
        ? ['meta/llama-3.1-8b-instruct', 'meta/llama-3.3-70b-instruct']
        : ['meta/llama-3.3-70b-instruct', 'qwen/qwen2.5-72b-instruct', 'meta/llama-3.1-8b-instruct'],
    supportsJsonFormat: false,
    endpoint: () => 'https://integrate.api.nvidia.com/v1/chat/completions',
    headers: (keys) => ({
      Authorization: `Bearer ${cleanStr(keys.nvidia)}`,
      'Content-Type': 'application/json',
    }),
  },
  cloudflare: {
    id: 'cloudflare',
    protocol: 'openai',
    models: (_k, tier) =>
      tier === 'lite'
        ? ['@cf/meta/llama-3.1-8b-instruct-fast', '@cf/meta/llama-3.1-8b-instruct']
        : ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'],
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
  mistral: {
    id: 'mistral',
    protocol: 'openai',
    models: () => ['mistral-small-latest', 'open-mistral-nemo'],
    supportsJsonFormat: true,
    endpoint: () => 'https://api.mistral.ai/v1/chat/completions',
    headers: (keys) => ({
      Authorization: `Bearer ${cleanStr(keys.mistral)}`,
      'Content-Type': 'application/json',
    }),
  },
  cohere: {
    id: 'cohere',
    protocol: 'cohere',
    models: () => ['command-a-03-2025', 'command-r-plus-08-2024', 'command-r-08-2024'],
    supportsJsonFormat: false,
    endpoint: () => 'https://api.cohere.com/v2/chat',
    headers: (keys) => ({
      Authorization: `Bearer ${cleanStr(keys.cohere)}`,
      'Content-Type': 'application/json',
    }),
  },
  custom1: {
    id: 'custom1',
    protocol: 'openai',
    models: (keys) => [cleanStr(keys.custom1Model) || 'gpt-4o-mini'],
    supportsJsonFormat: false,
    endpoint: (keys) => normalizeOpenAiEndpoint(cleanStr(keys.custom1Url)),
    headers: (keys) => ({
      Authorization: `Bearer ${cleanStr(keys.custom1Key)}`,
      'Content-Type': 'application/json',
    }),
  },
  custom2: {
    id: 'custom2',
    protocol: 'openai',
    models: (keys) => [cleanStr(keys.custom2Model) || 'gpt-4o-mini'],
    supportsJsonFormat: false,
    endpoint: (keys) => normalizeOpenAiEndpoint(cleanStr(keys.custom2Url)),
    headers: (keys) => ({
      Authorization: `Bearer ${cleanStr(keys.custom2Key)}`,
      'Content-Type': 'application/json',
    }),
  },
}

function buildMessages(
  req: BackupGenerateRequest,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
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
    ...(req.system ? [{ role: 'system' as const, content: `${req.system}${jsonHint}` }] : []),
    { role: 'user', content: req.prompt },
  ]
}

function extractResponseContent(json: unknown): string {
  if (!json || typeof json !== 'object') return ''
  const record = json as Record<string, unknown>

  // OpenAI compatible: choices[0].message.content
  const choices = record.choices as Array<{ message?: { content?: string } }> | undefined
  const openAiText = choices?.[0]?.message?.content
  if (typeof openAiText === 'string' && openAiText.trim()) return openAiText

  // Cloudflare native format: result.response
  const result = record.result as { response?: string } | undefined
  if (typeof result?.response === 'string' && result.response.trim()) return result.response

  // Cohere v2 format: message.content[{ type: 'text', text: '...' }]
  const message = record.message as { content?: Array<{ type?: string; text?: string }> | string } | undefined
  if (typeof message?.content === 'string' && message.content.trim()) return message.content
  if (Array.isArray(message?.content)) {
    const joined = message.content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
    if (joined.trim()) return joined
  }

  if (typeof record.text === 'string' && record.text.trim()) return record.text
  return ''
}

async function callSingleProviderModel(
  spec: ProviderSpec,
  keys: ServerAiBackupKeys,
  model: string,
  req: BackupGenerateRequest,
): Promise<string> {
  const endpoint = spec.endpoint(keys)
  if (!endpoint) throw new Error(`${spec.id} 接口地址无效`)

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
      if (withJsonFormat && req.expectJson && spec.supportsJsonFormat && spec.protocol === 'openai') {
        body.response_format = { type: 'json_object' }
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: spec.headers(keys),
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        const err = new Error(`${spec.id} HTTP ${response.status} ${detail.slice(0, 180)}`)
        ;(err as Error & { status?: number }).status = response.status
        throw err
      }
      const json = (await response.json()) as unknown
      const content = extractResponseContent(json)
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
  const models = spec.models(keys, req.tier)
  const meta = BATON_META[providerId]
  let lastError: unknown = null

  for (const model of models) {
    try {
      const text = await callSingleProviderModel(spec, keys, model, req)
      recordProviderSuccess(providerId)
      return {
        text,
        model: `${providerId}/${model}`,
        provider: providerId,
        providerName: meta.name,
        baton: meta.baton,
      }
    } catch (error) {
      lastError = error
      const status = (error as { status?: number }).status
      const msg = error instanceof Error ? error.message : String(error)
      const isModelNotFound =
        status === 404 || /model_not_found|decommissioned|not_found|does not exist/i.test(msg)
      recordProviderFailure(providerId, status, msg)
      if (status === 401 || status === 403 || status === 429) break
      if (isModelNotFound) continue
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${providerId} 调用失败`)
}

/**
 * 严格按接力顺序（第 2 棒 Groq → 第 3 棒 OpenRouter → 第 4 棒 Cerebras →
 * 第 5 棒 NVIDIA NIM → 第 6 棒 Cloudflare → 第 7 棒 Mistral → 第 8 棒 Cohere →
 * 第 9/10 棒自定义 OpenAI）依次接力执行；未配置 Key 的通道自动跳过。
 */
export async function callBackupProvidersServer(
  req: BackupGenerateRequest,
): Promise<BackupGeneration> {
  const keys = req.keys
  if (!keys || keys.enabled === false) {
    throw new Error('备用 AI 接力棒已关闭')
  }

  const configured = RELAY_ORDER.filter((id) => isBackupConfigured(id, keys))
  if (configured.length === 0) {
    throw new Error('未配置任何备用 AI 接力棒 Key')
  }

  const healthy = configured.filter((id) => !isProviderCoolingDown(id))
  const ordered = healthy.length > 0 ? healthy : configured

  let lastError: unknown = null
  for (const providerId of ordered) {
    try {
      return await callBackupProvider(providerId, req)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('全部 AI 接力通道均不可用')
}

export async function testBackupProviderServer(
  providerId: BackupProviderId,
  keys: ServerAiBackupKeys,
): Promise<{ ok: boolean; model?: string; providerName?: string; baton?: number; message?: string }> {
  try {
    const res = await callBackupProvider(providerId, {
      system: 'Reply with OK only.',
      prompt: 'Ping',
      tier: 'lite',
      maxOutputTokens: 16,
      temperature: 0,
      keys,
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
