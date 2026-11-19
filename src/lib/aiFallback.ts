import type { AiFallbackConfig, AiFallbackProviderId, ApiSettings } from '@/types'

export type AllClientAiProviderId = 'gemini' | AiFallbackProviderId
export type ClientAiTier = 'lite' | 'flash' | 'pro'

export interface AiBackupProviderMeta {
  id: AiFallbackProviderId
  label: string
  vendor: string
  accent: string
  keyLabel: string
  keyPlaceholder: string
  secondaryLabel?: string
  secondaryPlaceholder?: string
  role: string
  note: string
  docsUrl: string
}

export const AI_BACKUP_PROVIDERS: AiBackupProviderMeta[] = [
  {
    id: 'groq',
    label: 'GroqCloud',
    vendor: 'GROQ_API_KEY',
    accent: 'text-gold',
    keyLabel: 'Groq API Key',
    keyPlaceholder: 'gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    role: '极速新闻翻译/摘要与高频短文本降级',
    note: 'OpenAI 兼容接口（gpt-oss-20b / gpt-oss-120b），响应极快，专用于高频新闻批量翻译、摘要与极速降级。',
    docsUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    vendor: 'OPENROUTER_API_KEY',
    accent: 'text-ice',
    keyLabel: 'OpenRouter API Key',
    keyPlaceholder: 'sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    role: '自动调度 :free 免费模型池（财报与国债分析降级）',
    note: '自动聚合 OpenRouter :free 免费模型池（Llama 3.3 70B Free / Gemma 3 等），专用于财报日程、季度公告与固收国债分析降级。',
    docsUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    vendor: 'MISTRAL_API_KEY',
    accent: 'text-iris',
    keyLabel: 'Mistral API Key',
    keyPlaceholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    role: '结构化 JSON 摘要与深度研报降级',
    note: '支持结构化 JSON 模式（mistral-small-latest / open-mistral-nemo），专用于复杂裁决与结构化摘要降级。',
    docsUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    vendor: 'CF_ACCOUNT_ID + TOKEN',
    accent: 'text-gold',
    keyLabel: 'Cloudflare API Token',
    keyPlaceholder: 'Workers AI 权限 Token',
    secondaryLabel: 'Cloudflare Account ID',
    secondaryPlaceholder: '32 位 Account ID',
    role: '轻量边缘推理与并发分流',
    note: '需同时填写 Account ID 与 API Token；高并发批处理/多任务执行时自动分流，静态托管遇跨域限制可由后端代理转发。',
    docsUrl: 'https://dash.cloudflare.com/?to=/:account/ai/workers-ai',
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    vendor: 'NVIDIA_API_KEY',
    accent: 'text-bull',
    keyLabel: 'NVIDIA API Key',
    keyPlaceholder: 'nvapi-xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    role: '深度备用推理引擎',
    note: '接入 build.nvidia.com 免费额度（Llama 3.3 70B / Qwen 2.5 72B），适合深度推理降级备援。',
    docsUrl: 'https://build.nvidia.com/',
  },
]

export const DEFAULT_AI_FALLBACK: AiFallbackConfig = {
  enabled: true,
  groqKey: '',
  openrouterKey: '',
  mistralKey: '',
  cloudflareAccountId: '',
  cloudflareApiToken: '',
  nvidiaKey: '',
}

export function normalizeAiFallback(raw?: Partial<AiFallbackConfig> | null): AiFallbackConfig {
  return {
    enabled: raw?.enabled !== false,
    groqKey: typeof raw?.groqKey === 'string' ? raw.groqKey : '',
    openrouterKey: typeof raw?.openrouterKey === 'string' ? raw.openrouterKey : '',
    mistralKey: typeof raw?.mistralKey === 'string' ? raw.mistralKey : '',
    cloudflareAccountId: typeof raw?.cloudflareAccountId === 'string' ? raw.cloudflareAccountId : '',
    cloudflareApiToken: typeof raw?.cloudflareApiToken === 'string' ? raw.cloudflareApiToken : '',
    nvidiaKey: typeof raw?.nvidiaKey === 'string' ? raw.nvidiaKey : '',
  }
}

let activeFallbackConfig: AiFallbackConfig = { ...DEFAULT_AI_FALLBACK }

export function setActiveAiFallbackConfig(config?: Partial<AiFallbackConfig> | null): void {
  activeFallbackConfig = normalizeAiFallback(config)
}

export function getActiveAiFallbackConfig(): AiFallbackConfig {
  return activeFallbackConfig
}

export function isBackupProviderConfigured(
  id: AiFallbackProviderId,
  config: AiFallbackConfig = activeFallbackConfig,
): boolean {
  switch (id) {
    case 'groq':
      return config.groqKey.trim().length > 0
    case 'openrouter':
      return config.openrouterKey.trim().length > 0
    case 'mistral':
      return config.mistralKey.trim().length > 0
    case 'cloudflare':
      return config.cloudflareAccountId.trim().length > 0 && config.cloudflareApiToken.trim().length > 0
    case 'nvidia':
      return config.nvidiaKey.trim().length > 0
  }
}

export function countConfiguredBackupAi(config: AiFallbackConfig = activeFallbackConfig): number {
  return AI_BACKUP_PROVIDERS.filter((item) => isBackupProviderConfigured(item.id, config)).length
}

export function hasConfiguredBackupAi(config: AiFallbackConfig = activeFallbackConfig): boolean {
  if (!config.enabled) return false
  return countConfiguredBackupAi(config) > 0
}

export function hasAnyAiConfigured(settings?: ApiSettings): boolean {
  if (!settings) {
    return hasConfiguredBackupAi(activeFallbackConfig)
  }
  const hasGemini = settings.geminiKey.trim().length > 0
  const fallback = settings.aiFallback ? normalizeAiFallback(settings.aiFallback) : activeFallbackConfig
  return hasGemini || hasConfiguredBackupAi(fallback)
}

// ---------------------------------------------------------------------------
// 浏览器端熔断冷却 + 并发分流追踪
// ---------------------------------------------------------------------------

interface ClientCircuit {
  failures: number
  cooldownUntil: number
}

const clientCircuits = new Map<AllClientAiProviderId, ClientCircuit>()
let inFlightGemini = 0
let roundRobinCursor = 0
export const MAX_CLIENT_GEMINI_CONCURRENCY = 2
const CLIENT_TIMEOUT_MS = 30_000

export function enterGeminiClientSlot(): void {
  inFlightGemini += 1
}

export function leaveGeminiClientSlot(): void {
  inFlightGemini = Math.max(0, inFlightGemini - 1)
}

export function isClientProviderCoolingDown(id: AllClientAiProviderId): boolean {
  const state = clientCircuits.get(id)
  if (!state) return false
  if (state.cooldownUntil > Date.now()) return true
  if (state.cooldownUntil > 0) state.cooldownUntil = 0
  return false
}

export function recordClientProviderSuccess(id: AllClientAiProviderId): void {
  clientCircuits.set(id, { failures: 0, cooldownUntil: 0 })
}

export function recordClientProviderFailure(
  id: AllClientAiProviderId,
  status?: number,
  message = '',
): void {
  const prev = clientCircuits.get(id) ?? { failures: 0, cooldownUntil: 0 }
  const failures = prev.failures + 1
  const isRateLimit =
    status === 429 || /rate.?limit|quota|too many requests|resource_exhausted/i.test(message)
  const isAuthError = status === 401 || status === 403 || /invalid.*key|unauthorized/i.test(message)

  let cooldownMs = 0
  if (isAuthError) cooldownMs = 300_000
  else if (isRateLimit) cooldownMs = 60_000
  else if (failures >= 2) cooldownMs = 120_000

  clientCircuits.set(id, {
    failures,
    cooldownUntil: cooldownMs > 0 ? Date.now() + cooldownMs : 0,
  })
}

export function shouldOffloadClientGemini(config: AiFallbackConfig = activeFallbackConfig): boolean {
  return inFlightGemini >= MAX_CLIENT_GEMINI_CONCURRENCY && hasConfiguredBackupAi(config)
}

// ---------------------------------------------------------------------------
// OpenAI 兼容浏览器端调用 + /api/ai/complete 自动跨域代理兜底
// ---------------------------------------------------------------------------

interface ClientProviderSpec {
  id: AiFallbackProviderId
  models: Record<ClientAiTier, string[]>
  supportsJsonFormat: boolean
  endpoint: (config: AiFallbackConfig) => string
  headers: (config: AiFallbackConfig) => Record<string, string>
}

const CLIENT_SPECS: Record<AiFallbackProviderId, ClientProviderSpec> = {
  groq: {
    id: 'groq',
    models: {
      lite: ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b'],
      flash: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
      pro: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
    },
    supportsJsonFormat: true,
    endpoint: () => 'https://api.groq.com/openai/v1/chat/completions',
    headers: (c) => ({
      Authorization: `Bearer ${c.groqKey.trim()}`,
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
    headers: (c) => ({
      Authorization: `Bearer ${c.openrouterKey.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': typeof location !== 'undefined' ? location.origin : 'https://apex-terminal.local',
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
    headers: (c) => ({
      Authorization: `Bearer ${c.mistralKey.trim()}`,
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
    endpoint: (c) =>
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        c.cloudflareAccountId.trim(),
      )}/ai/v1/chat/completions`,
    headers: (c) => ({
      Authorization: `Bearer ${c.cloudflareApiToken.trim()}`,
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
    headers: (c) => ({
      Authorization: `Bearer ${c.nvidiaKey.trim()}`,
      'Content-Type': 'application/json',
    }),
  },
}

const TIER_PRIORITY: Record<ClientAiTier, AiFallbackProviderId[]> = {
  lite: ['groq', 'cloudflare', 'mistral', 'openrouter', 'nvidia'],
  flash: ['groq', 'openrouter', 'mistral', 'nvidia', 'cloudflare'],
  pro: ['openrouter', 'nvidia', 'mistral', 'groq', 'cloudflare'],
}

export interface ClientBackupRequest {
  system: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  tier: ClientAiTier
  temperature?: number
  maxOutputTokens?: number
  expectJson?: boolean
  signal?: AbortSignal
  rotate?: boolean
  config?: AiFallbackConfig
}

async function callViaServerProxy(
  providerId: AiFallbackProviderId,
  req: ClientBackupRequest,
  config: AiFallbackConfig,
): Promise<{ text: string; model: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  req.signal?.addEventListener('abort', onAbort)

  try {
    const response = await fetch('/api/ai/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        action: 'complete',
        provider: providerId,
        system: req.system,
        messages: req.messages,
        tier: req.tier,
        temperature: req.temperature,
        maxOutputTokens: req.maxOutputTokens,
        expectJson: req.expectJson,
        aiFallback: config,
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Proxy HTTP ${response.status}`)
    const data = (await response.json()) as { ok?: boolean; text?: string; model?: string; error?: string }
    if (!data.ok || !data.text) throw new Error(data.error || '代理未返回内容')
    return { text: data.text, model: data.model ?? `${providerId}/proxy` }
  } finally {
    clearTimeout(timer)
    req.signal?.removeEventListener('abort', onAbort)
  }
}

async function callSingleClientProvider(
  id: AiFallbackProviderId,
  req: ClientBackupRequest,
  config: AiFallbackConfig,
): Promise<{ text: string; model: string }> {
  const spec = CLIENT_SPECS[id]
  const jsonHint = req.expectJson
    ? '\n\n[STRICT OUTPUT] 只输出合法 JSON 对象，禁止额外 Markdown 说明。'
    : ''
  const messages = [
    ...(req.system ? [{ role: 'system' as const, content: `${req.system}${jsonHint}` }] : []),
    ...req.messages,
  ]

  let lastError: unknown = null
  for (const model of spec.models[req.tier]) {
    const attempt = async (withJsonFormat: boolean): Promise<string> => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)
      const onAbort = () => controller.abort()
      req.signal?.addEventListener('abort', onAbort)
      try {
        const body: Record<string, unknown> = {
          model,
          messages,
          temperature: req.temperature ?? 0.3,
          max_tokens: Math.min(req.maxOutputTokens ?? 3072, 4096),
        }
        if (withJsonFormat && req.expectJson && spec.supportsJsonFormat) {
          body.response_format = { type: 'json_object' }
        }
        const response = await fetch(spec.endpoint(config), {
          method: 'POST',
          headers: spec.headers(config),
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          const err = new Error(`${id} HTTP ${response.status} ${detail.slice(0, 140)}`)
          ;(err as Error & { status?: number }).status = response.status
          throw err
        }
        const json = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>
          result?: { response?: string }
        }
        const content = json.choices?.[0]?.message?.content ?? json.result?.response ?? ''
        if (!content.trim()) throw new Error(`${id} 返回空内容`)
        return content
      } finally {
        clearTimeout(timer)
        req.signal?.removeEventListener('abort', onAbort)
      }
    }

    try {
      const text = await attempt(true)
      recordClientProviderSuccess(id)
      return { text, model: `${id}/${model}` }
    } catch (error) {
      if (req.signal?.aborted) throw error
      const status = (error as { status?: number }).status
      // 如果直连遇到浏览器 CORS / TypeError，则尝试经同源 /api/ai/complete 代理转发（Vercel / 本地节点可用）
      if (status === undefined) {
        try {
          const proxied = await callViaServerProxy(id, req, config)
          recordClientProviderSuccess(id)
          return proxied
        } catch (proxyErr) {
          lastError = proxyErr
        }
      } else if (status === 400 && req.expectJson && spec.supportsJsonFormat) {
        try {
          const retried = await attempt(false)
          recordClientProviderSuccess(id)
          return { text: retried, model: `${id}/${model}` }
        } catch (retryErr) {
          lastError = retryErr
        }
      } else {
        lastError = error
      }
      const msg = lastError instanceof Error ? lastError.message : String(lastError)
      const isModelNotFound = status === 404 || /model_not_found|decommissioned|not_found|does not exist/i.test(msg)
      recordClientProviderFailure(id, status, msg)
      if (status === 401 || status === 403 || status === 429) break
      if (isModelNotFound) continue
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${id} 请求失败`)
}

export async function callBackupProvidersClient(
  req: ClientBackupRequest,
): Promise<{ text: string; model: string }> {
  const config = req.config ?? activeFallbackConfig
  if (!config.enabled) throw new Error('备用免费服务商兜底未启用')

  const configured = TIER_PRIORITY[req.tier].filter((id) => isBackupProviderConfigured(id, config))
  if (configured.length === 0) throw new Error('未配置任何备用免费 AI Key')

  const healthy = configured.filter((id) => !isClientProviderCoolingDown(id))
  const candidates = healthy.length > 0 ? healthy : configured
  let ordered = candidates
  if (req.rotate && candidates.length > 1) {
    const shift = roundRobinCursor % candidates.length
    roundRobinCursor = (roundRobinCursor + 1) % candidates.length
    ordered = [...candidates.slice(shift), ...candidates.slice(0, shift)]
  }

  let lastError: unknown = null
  for (const id of ordered) {
    try {
      return await callSingleClientProvider(id, req, config)
    } catch (error) {
      if (req.signal?.aborted) throw error
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('全部备用免费服务商均不可用')
}

export async function testBackupProviderClient(
  id: AiFallbackProviderId,
  config: AiFallbackConfig,
  signal?: AbortSignal,
): Promise<{ ok: boolean; model?: string; message?: string }> {
  try {
    const res = await callSingleClientProvider(
      id,
      {
        system: 'Reply OK only.',
        messages: [{ role: 'user', content: 'Ping' }],
        tier: 'lite',
        maxOutputTokens: 16,
        temperature: 0,
        signal,
        config: { ...config, enabled: true },
      },
      { ...config, enabled: true },
    )
    return { ok: true, model: res.model }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 将 `provider/model` 与组合模型标签格式化为角标展示文案
 */
export function formatBackupModelDisplay(raw: string): string {
  const text = (raw ?? '').trim()
  if (!text) return ''

  if (text.includes(' + ')) {
    return text
      .split(' + ')
      .map((part) => formatBackupModelDisplay(part))
      .slice(0, 2)
      .join(' + ')
  }

  const lower = text.toLowerCase()
  const shortClean = (name: string) =>
    name
      .replace(/^meta-llama\//i, '')
      .replace(/^meta\//i, '')
      .replace(/^@cf\/meta\//i, '')
      .replace(/^google\//i, '')
      .replace(/^qwen\//i, '')
      .replace(/:free$/i, ' Free')

  if (lower.startsWith('groq/')) return `Groq · ${shortClean(text.slice(5))}`
  if (lower.startsWith('openrouter/')) return `OpenRouter · ${shortClean(text.slice(11))}`
  if (lower.startsWith('mistral/')) return `Mistral · ${shortClean(text.slice(8))}`
  if (lower.startsWith('cloudflare/')) return `Cloudflare · ${shortClean(text.slice(11))}`
  if (lower.startsWith('nvidia/')) return `NVIDIA · ${shortClean(text.slice(7))}`
  return text
}
