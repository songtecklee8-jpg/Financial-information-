import type {
  AiFallbackConfig,
  AiFallbackProviderId,
  AllAiProviderId,
  ApiSettings,
  RelayMeta,
  ServerEnvStatus,
} from '@/types'

export type AllClientAiProviderId = AllAiProviderId
export type ClientAiTier = 'lite' | 'flash' | 'pro'

export const RELAY_ORDER: AiFallbackProviderId[] = [
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

export interface AiBackupProviderMeta {
  id: AiFallbackProviderId
  baton: number
  label: string
  vendor: string
  accent: string
  keyLabel: string
  keyPlaceholder: string
  secondaryLabel?: string
  secondaryPlaceholder?: string
  modelLabel?: string
  modelPlaceholder?: string
  role: string
  note: string
  docsUrl: string
}

export const AI_BACKUP_PROVIDERS: AiBackupProviderMeta[] = [
  {
    id: 'groq',
    baton: 2,
    label: '第 2 棒 · GroqCloud',
    vendor: 'GROQ_API_KEY',
    accent: 'text-gold',
    keyLabel: 'Groq API Key',
    keyPlaceholder: 'gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    role: '极速第一替补（Llama 3.3 70B / GPT-OSS 120B）',
    note: 'OpenAI 兼容极速接口（llama-3.3-70b-versatile / openai/gpt-oss-120b），Gemini 限流后立刻无缝顶替。',
    docsUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'openrouter',
    baton: 3,
    label: '第 3 棒 · OpenRouter',
    vendor: 'OPENROUTER_API_KEY',
    accent: 'text-ice',
    keyLabel: 'OpenRouter API Key',
    keyPlaceholder: 'sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    role: '自动调度 openrouter/free 免费模型池',
    note: '自动调度 openrouter/free 与 :free 免费大模型池，支持复杂研报与 CFA 长文本讲解。',
    docsUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'cerebras',
    baton: 4,
    label: '第 4 棒 · Cerebras',
    vendor: 'CEREBRAS_API_KEY',
    accent: 'text-gold',
    keyLabel: 'Cerebras API Key',
    keyPlaceholder: 'csk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    role: '晶圆级超低延迟推理（Llama 3.3 70B / Qwen）',
    note: '免费额度高且生成速度极快（llama-3.3-70b / qwen-3-32b），适合接力长篇精讲与测验生成。',
    docsUrl: 'https://cloud.cerebras.ai/',
  },
  {
    id: 'nvidia',
    baton: 5,
    label: '第 5 棒 · NVIDIA NIM',
    vendor: 'NVIDIA_API_KEY',
    accent: 'text-bull',
    keyLabel: 'NVIDIA API Key',
    keyPlaceholder: 'nvapi-xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    role: '企业级大模型免费试用通道',
    note: '接入 build.nvidia.com 免费额度（Llama 3.3 70B / Qwen 2.5 72B），自动经服务端代理防跨域报错。',
    docsUrl: 'https://build.nvidia.com/',
  },
  {
    id: 'cloudflare',
    baton: 6,
    label: '第 6 棒 · Cloudflare Workers AI',
    vendor: 'CLOUDFLARE_ACCOUNT_ID + API_TOKEN',
    accent: 'text-gold',
    keyLabel: 'Cloudflare API Token',
    keyPlaceholder: 'Workers AI Token',
    secondaryLabel: 'Cloudflare Account ID',
    secondaryPlaceholder: '32 位 Account ID',
    role: '全球边缘节点每日免费额度',
    note: '需填写 Account ID 与 API Token；如遇浏览器跨域限制，自动经后端 /api/ai/complete 转发。',
    docsUrl: 'https://dash.cloudflare.com/?to=/:account/ai/workers-ai',
  },
  {
    id: 'mistral',
    baton: 7,
    label: '第 7 棒 · Mistral',
    vendor: 'MISTRAL_API_KEY',
    accent: 'text-iris',
    keyLabel: 'Mistral API Key',
    keyPlaceholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    role: '原生结构化 JSON 与欧洲主流旗舰模型',
    note: '支持结构化 JSON 模式（mistral-small-latest / open-mistral-nemo），适合结构化题库与要点输出。',
    docsUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'cohere',
    baton: 8,
    label: '第 8 棒 · Cohere',
    vendor: 'COHERE_API_KEY',
    accent: 'text-ice',
    keyLabel: 'Cohere API Key',
    keyPlaceholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    role: '企业长上下文与 RAG 理解（Command A / R+）',
    note: '使用 Cohere v2 Chat 接口（command-a-03-2025 / command-r-plus-08-2024），长文档理解稳健。',
    docsUrl: 'https://dashboard.cohere.com/api-keys',
  },
  {
    id: 'custom1',
    baton: 9,
    label: '第 9 棒 · 自定义 OpenAI 兼容 #1',
    vendor: 'CUSTOM_OPENAI_1_URL / KEY / MODEL',
    accent: 'text-dim',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
    secondaryLabel: 'Base URL（如 https://api.deepseek.com）',
    secondaryPlaceholder: 'https://your-endpoint.com/v1',
    modelLabel: '模型名称（Model ID）',
    modelPlaceholder: '例如 deepseek-chat 或 gpt-4o-mini',
    role: '自定义 OpenAI 兼容通道（槽位 1）',
    note: '可接入 DeepSeek、SiliconFlow、Ollama 穿透或任何第三方 OpenAI 兼容接口。',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
  },
  {
    id: 'custom2',
    baton: 10,
    label: '第 10 棒 · 自定义 OpenAI 兼容 #2',
    vendor: 'CUSTOM_OPENAI_2_URL / KEY / MODEL',
    accent: 'text-dim',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
    secondaryLabel: 'Base URL（如 https://api.together.xyz/v1）',
    secondaryPlaceholder: 'https://your-endpoint.com/v1',
    modelLabel: '模型名称（Model ID）',
    modelPlaceholder: '例如 Qwen/Qwen2.5-72B-Instruct',
    role: '自定义 OpenAI 兼容通道（槽位 2）',
    note: '作为最终兜底槽位，在前 9 棒全部限流或不可用时接力完成请求。',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
  },
]

export const DEFAULT_AI_FALLBACK: AiFallbackConfig = {
  enabled: true,
  geminiKey2: '',
  geminiKey3: '',
  groqKey: '',
  openrouterKey: '',
  cerebrasKey: '',
  nvidiaKey: '',
  cloudflareAccountId: '',
  cloudflareApiToken: '',
  mistralKey: '',
  cohereKey: '',
  custom1Url: '',
  custom1Key: '',
  custom1Model: '',
  custom2Url: '',
  custom2Key: '',
  custom2Model: '',
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function normalizeAiFallback(raw?: Partial<AiFallbackConfig> | null): AiFallbackConfig {
  return {
    enabled: raw?.enabled !== false,
    geminiKey2: str(raw?.geminiKey2),
    geminiKey3: str(raw?.geminiKey3),
    groqKey: str(raw?.groqKey),
    openrouterKey: str(raw?.openrouterKey),
    cerebrasKey: str(raw?.cerebrasKey),
    nvidiaKey: str(raw?.nvidiaKey),
    cloudflareAccountId: str(raw?.cloudflareAccountId),
    cloudflareApiToken: str(raw?.cloudflareApiToken),
    mistralKey: str(raw?.mistralKey),
    cohereKey: str(raw?.cohereKey),
    custom1Url: str(raw?.custom1Url),
    custom1Key: str(raw?.custom1Key),
    custom1Model: str(raw?.custom1Model),
    custom2Url: str(raw?.custom2Url),
    custom2Key: str(raw?.custom2Key),
    custom2Model: str(raw?.custom2Model),
  }
}

let activeFallbackConfig: AiFallbackConfig = { ...DEFAULT_AI_FALLBACK }
let serverEnvStatus: ServerEnvStatus | null = null
let serverProxyUnavailableUntil = 0

export function setActiveAiFallbackConfig(config?: Partial<AiFallbackConfig> | null): void {
  activeFallbackConfig = normalizeAiFallback(config)
}

export function getActiveAiFallbackConfig(): AiFallbackConfig {
  return activeFallbackConfig
}

export function setServerEnvStatus(status: ServerEnvStatus | null): void {
  serverEnvStatus = status
}

export function getServerEnvStatus(): ServerEnvStatus | null {
  return serverEnvStatus
}

export async function probeServerEnvStatus(signal?: AbortSignal): Promise<ServerEnvStatus | null> {
  try {
    const res = await fetch('/api/ai/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action: 'status' }),
      signal,
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return null
    const data = (await res.json()) as { ok?: boolean; envConfigured?: ServerEnvStatus }
    if (data?.ok && data.envConfigured) {
      serverEnvStatus = data.envConfigured
      return data.envConfigured
    }
    return null
  } catch {
    return null
  }
}

export function normalizeOpenAiEndpoint(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) return ''
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  if (/\/(v1|v1beta\/openai|openai)$/i.test(trimmed)) return `${trimmed}/chat/completions`
  return `${trimmed}/v1/chat/completions`
}

export function collectClientGeminiKeys(settings?: Pick<ApiSettings, 'geminiKey' | 'aiFallback'>): string[] {
  const fb = settings?.aiFallback ? normalizeAiFallback(settings.aiFallback) : activeFallbackConfig
  const candidates = [settings?.geminiKey ?? '', fb.geminiKey2, fb.geminiKey3]
  const out: string[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    const k = c.trim()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
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
    case 'cerebras':
      return config.cerebrasKey.trim().length > 0
    case 'nvidia':
      return config.nvidiaKey.trim().length > 0
    case 'cloudflare':
      return config.cloudflareAccountId.trim().length > 0 && config.cloudflareApiToken.trim().length > 0
    case 'mistral':
      return config.mistralKey.trim().length > 0
    case 'cohere':
      return config.cohereKey.trim().length > 0
    case 'custom1':
      return normalizeOpenAiEndpoint(config.custom1Url).length > 0 && config.custom1Key.trim().length > 0
    case 'custom2':
      return normalizeOpenAiEndpoint(config.custom2Url).length > 0 && config.custom2Key.trim().length > 0
  }
}

export function isBatonAvailableIncludingServer(
  id: AllAiProviderId,
  settings?: Pick<ApiSettings, 'geminiKey' | 'aiFallback'>,
): boolean {
  const fb = settings?.aiFallback ? normalizeAiFallback(settings.aiFallback) : activeFallbackConfig
  if (id === 'gemini') {
    const clientKeys = collectClientGeminiKeys(settings)
    return clientKeys.length > 0 || Boolean(serverEnvStatus && serverEnvStatus.geminiCount > 0)
  }
  const envFlag = serverEnvStatus ? serverEnvStatus[id] : false
  return envFlag || isBackupProviderConfigured(id, fb)
}

export function countConfiguredBackupAi(config: AiFallbackConfig = activeFallbackConfig): number {
  return AI_BACKUP_PROVIDERS.filter(
    (item) => isBackupProviderConfigured(item.id, config) || Boolean(serverEnvStatus?.[item.id]),
  ).length
}

export function hasConfiguredBackupAi(config: AiFallbackConfig = activeFallbackConfig): boolean {
  if (!config.enabled) return false
  return countConfiguredBackupAi(config) > 0
}

export function hasAnyServerEnvAi(): boolean {
  if (!serverEnvStatus) return false
  return (
    serverEnvStatus.geminiCount > 0 ||
    serverEnvStatus.groq ||
    serverEnvStatus.openrouter ||
    serverEnvStatus.cerebras ||
    serverEnvStatus.nvidia ||
    serverEnvStatus.cloudflare ||
    serverEnvStatus.mistral ||
    serverEnvStatus.cohere ||
    serverEnvStatus.custom1 ||
    serverEnvStatus.custom2
  )
}

export function hasAnyAiConfigured(settings?: ApiSettings): boolean {
  if (hasAnyServerEnvAi()) return true
  if (!settings) {
    return hasConfiguredBackupAi(activeFallbackConfig)
  }
  const hasGemini = collectClientGeminiKeys(settings).length > 0
  const fallback = settings.aiFallback ? normalizeAiFallback(settings.aiFallback) : activeFallbackConfig
  return hasGemini || hasConfiguredBackupAi(fallback)
}

// ---------------------------------------------------------------------------
// 浏览器端熔断冷却追踪
// ---------------------------------------------------------------------------

interface ClientCircuit {
  failures: number
  cooldownUntil: number
}

const clientCircuits = new Map<AllClientAiProviderId, ClientCircuit>()
const CLIENT_TIMEOUT_MS = 32_000

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
  if (isAuthError) cooldownMs = 180_000
  else if (isRateLimit) cooldownMs = 45_000
  else if (failures >= 2) cooldownMs = 60_000

  clientCircuits.set(id, {
    failures,
    cooldownUntil: cooldownMs > 0 ? Date.now() + cooldownMs : 0,
  })
}

// ---------------------------------------------------------------------------
// 服务端接力代理 & 浏览器直连双通道实现
// ---------------------------------------------------------------------------

export function canTryServerProxy(): boolean {
  return Date.now() >= serverProxyUnavailableUntil
}

export async function callRelayViaServerProxy(params: {
  geminiKey?: string
  aiRouting?: string
  customModel?: string
  system: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  tier: ClientAiTier
  temperature?: number
  maxOutputTokens?: number
  expectJson?: boolean
  responseSchema?: Record<string, unknown>
  signal?: AbortSignal
  config?: AiFallbackConfig
}): Promise<{ text: string; model: string; relay: RelayMeta }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS + 10_000)
  const onAbort = () => controller.abort()
  params.signal?.addEventListener('abort', onAbort)

  try {
    const response = await fetch('/api/ai/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        action: 'relay',
        geminiKey: params.geminiKey ?? '',
        aiRouting: params.aiRouting,
        customModel: params.customModel,
        system: params.system,
        messages: params.messages,
        tier: params.tier,
        temperature: params.temperature,
        maxOutputTokens: params.maxOutputTokens,
        expectJson: params.expectJson,
        responseSchema: params.responseSchema,
        aiFallback: params.config ?? activeFallbackConfig,
      }),
      signal: controller.signal,
    })

    if (response.status === 404 || response.status === 405 || response.status >= 500) {
      serverProxyUnavailableUntil = Date.now() + 60_000
      throw new Error(`PROXY_UNAVAILABLE_${response.status}`)
    }

    const ct = response.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) {
      serverProxyUnavailableUntil = Date.now() + 60_000
      throw new Error('PROXY_UNAVAILABLE_NON_JSON')
    }

    const data = (await response.json()) as {
      ok?: boolean
      text?: string
      model?: string
      provider?: AllAiProviderId
      providerName?: string
      baton?: number
      error?: string
    }
    if (!data.ok || !data.text) {
      throw new Error(data.error || '接力代理未返回内容')
    }
    const providerId = data.provider ?? inferProviderFromModel(data.model ?? '')
    const meta = BATON_META[providerId]
    return {
      text: data.text,
      model: data.model ?? 'gemini-2.5-flash',
      relay: {
        baton: data.baton ?? meta.baton,
        providerId,
        providerName: data.providerName ?? meta.name,
        model: data.model ?? 'gemini-2.5-flash',
      },
    }
  } catch (err) {
    if (err instanceof TypeError) {
      serverProxyUnavailableUntil = Date.now() + 60_000
    }
    throw err
  } finally {
    clearTimeout(timer)
    params.signal?.removeEventListener('abort', onAbort)
  }
}

interface ClientProviderSpec {
  id: AiFallbackProviderId
  protocol: 'openai' | 'cohere'
  models: (c: AiFallbackConfig, tier: ClientAiTier) => string[]
  supportsJsonFormat: boolean
  endpoint: (c: AiFallbackConfig) => string
  headers: (c: AiFallbackConfig) => Record<string, string>
}

const CLIENT_SPECS: Record<AiFallbackProviderId, ClientProviderSpec> = {
  groq: {
    id: 'groq',
    protocol: 'openai',
    models: (_c, tier) =>
      tier === 'lite'
        ? ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b']
        : ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
    supportsJsonFormat: true,
    endpoint: () => 'https://api.groq.com/openai/v1/chat/completions',
    headers: (c) => ({
      Authorization: `Bearer ${c.groqKey.trim()}`,
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
    headers: (c) => ({
      Authorization: `Bearer ${c.openrouterKey.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': typeof location !== 'undefined' ? location.origin : 'https://apex-research.local',
      'X-Title': 'APEX Research',
    }),
  },
  cerebras: {
    id: 'cerebras',
    protocol: 'openai',
    models: () => ['llama-3.3-70b', 'qwen-3-32b', 'llama3.1-8b'],
    supportsJsonFormat: true,
    endpoint: () => 'https://api.cerebras.ai/v1/chat/completions',
    headers: (c) => ({
      Authorization: `Bearer ${c.cerebrasKey.trim()}`,
      'Content-Type': 'application/json',
    }),
  },
  nvidia: {
    id: 'nvidia',
    protocol: 'openai',
    models: (_c, tier) =>
      tier === 'lite'
        ? ['meta/llama-3.1-8b-instruct', 'meta/llama-3.3-70b-instruct']
        : ['meta/llama-3.3-70b-instruct', 'qwen/qwen2.5-72b-instruct', 'meta/llama-3.1-8b-instruct'],
    supportsJsonFormat: false,
    endpoint: () => 'https://integrate.api.nvidia.com/v1/chat/completions',
    headers: (c) => ({
      Authorization: `Bearer ${c.nvidiaKey.trim()}`,
      'Content-Type': 'application/json',
    }),
  },
  cloudflare: {
    id: 'cloudflare',
    protocol: 'openai',
    models: (_c, tier) =>
      tier === 'lite'
        ? ['@cf/meta/llama-3.1-8b-instruct-fast', '@cf/meta/llama-3.1-8b-instruct']
        : ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'],
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
  mistral: {
    id: 'mistral',
    protocol: 'openai',
    models: () => ['mistral-small-latest', 'open-mistral-nemo'],
    supportsJsonFormat: true,
    endpoint: () => 'https://api.mistral.ai/v1/chat/completions',
    headers: (c) => ({
      Authorization: `Bearer ${c.mistralKey.trim()}`,
      'Content-Type': 'application/json',
    }),
  },
  cohere: {
    id: 'cohere',
    protocol: 'cohere',
    models: () => ['command-a-03-2025', 'command-r-plus-08-2024', 'command-r-08-2024'],
    supportsJsonFormat: false,
    endpoint: () => 'https://api.cohere.com/v2/chat',
    headers: (c) => ({
      Authorization: `Bearer ${c.cohereKey.trim()}`,
      'Content-Type': 'application/json',
    }),
  },
  custom1: {
    id: 'custom1',
    protocol: 'openai',
    models: (c) => [c.custom1Model.trim() || 'gpt-4o-mini'],
    supportsJsonFormat: false,
    endpoint: (c) => normalizeOpenAiEndpoint(c.custom1Url),
    headers: (c) => ({
      Authorization: `Bearer ${c.custom1Key.trim()}`,
      'Content-Type': 'application/json',
    }),
  },
  custom2: {
    id: 'custom2',
    protocol: 'openai',
    models: (c) => [c.custom2Model.trim() || 'gpt-4o-mini'],
    supportsJsonFormat: false,
    endpoint: (c) => normalizeOpenAiEndpoint(c.custom2Url),
    headers: (c) => ({
      Authorization: `Bearer ${c.custom2Key.trim()}`,
      'Content-Type': 'application/json',
    }),
  },
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

function extractClientResponseText(json: unknown): string {
  if (!json || typeof json !== 'object') return ''
  const record = json as Record<string, unknown>
  const choices = record.choices as Array<{ message?: { content?: string } }> | undefined
  const openAiText = choices?.[0]?.message?.content
  if (typeof openAiText === 'string' && openAiText.trim()) return openAiText
  const result = record.result as { response?: string } | undefined
  if (typeof result?.response === 'string' && result.response.trim()) return result.response
  const message = record.message as { content?: Array<{ type?: string; text?: string }> | string } | undefined
  if (typeof message?.content === 'string' && message.content.trim()) return message.content
  if (Array.isArray(message?.content)) {
    const joined = message.content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
    if (joined.trim()) return joined
  }
  return ''
}

async function callViaServerProxy(
  providerId: AllAiProviderId,
  req: ClientBackupRequest,
  config: AiFallbackConfig,
  geminiKey?: string,
): Promise<{ text: string; model: string; relay: RelayMeta }> {
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
        geminiKey: geminiKey ?? '',
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
    const data = (await response.json()) as {
      ok?: boolean
      text?: string
      model?: string
      baton?: number
      providerName?: string
      error?: string
    }
    if (!data.ok || !data.text) throw new Error(data.error || '代理未返回内容')
    const meta = BATON_META[providerId]
    const model = data.model ?? `${providerId}/proxy`
    return {
      text: data.text,
      model,
      relay: {
        baton: data.baton ?? meta.baton,
        providerId,
        providerName: data.providerName ?? meta.name,
        model,
      },
    }
  } finally {
    clearTimeout(timer)
    req.signal?.removeEventListener('abort', onAbort)
  }
}

async function callSingleClientProvider(
  id: AiFallbackProviderId,
  req: ClientBackupRequest,
  config: AiFallbackConfig,
): Promise<{ text: string; model: string; relay: RelayMeta }> {
  const spec = CLIENT_SPECS[id]
  const meta = BATON_META[id]
  const endpoint = spec.endpoint(config)
  if (!endpoint) throw new Error(`${meta.name} 接口地址无效`)

  const jsonHint = req.expectJson
    ? '\n\n[STRICT OUTPUT] 只输出合法 JSON 对象，禁止额外 Markdown 说明。'
    : ''
  const messages = [
    ...(req.system ? [{ role: 'system' as const, content: `${req.system}${jsonHint}` }] : []),
    ...req.messages,
  ]

  let lastError: unknown = null
  for (const model of spec.models(config, req.tier)) {
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
        if (withJsonFormat && req.expectJson && spec.supportsJsonFormat && spec.protocol === 'openai') {
          body.response_format = { type: 'json_object' }
        }
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: spec.headers(config),
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          const err = new Error(`${id} HTTP ${response.status} ${detail.slice(0, 160)}`)
          ;(err as Error & { status?: number }).status = response.status
          throw err
        }
        const json = (await response.json()) as unknown
        const content = extractClientResponseText(json)
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
      const fullModel = `${id}/${model}`
      return {
        text,
        model: fullModel,
        relay: {
          baton: meta.baton,
          providerId: id,
          providerName: meta.name,
          model: fullModel,
        },
      }
    } catch (error) {
      if (req.signal?.aborted) throw error
      const status = (error as { status?: number }).status
      // CORS 拦截或浏览器直连受阻时自动回退经服务端 /api/ai/complete 转发
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
          const fullModel = `${id}/${model}`
          return {
            text: retried,
            model: fullModel,
            relay: {
              baton: meta.baton,
              providerId: id,
              providerName: meta.name,
              model: fullModel,
            },
          }
        } catch (retryErr) {
          lastError = retryErr
        }
      } else {
        lastError = error
      }
      const msg = lastError instanceof Error ? lastError.message : String(lastError)
      const isModelNotFound =
        status === 404 || /model_not_found|decommissioned|not_found|does not exist/i.test(msg)
      recordClientProviderFailure(id, status, msg)
      if (status === 401 || status === 403 || status === 429) break
      if (isModelNotFound) continue
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${id} 请求失败`)
}

export async function callBackupProvidersClient(
  req: ClientBackupRequest,
): Promise<{ text: string; model: string; relay: RelayMeta }> {
  const config = req.config ?? activeFallbackConfig
  if (!config.enabled) throw new Error('备用 AI 接力棒已关闭')

  const configured = RELAY_ORDER.filter((id) => isBackupProviderConfigured(id, config))
  if (configured.length === 0) throw new Error('未配置任何第 2–10 棒备用 AI Key')

  const healthy = configured.filter((id) => !isClientProviderCoolingDown(id))
  const ordered = healthy.length > 0 ? healthy : configured

  let lastError: unknown = null
  for (const id of ordered) {
    try {
      return await callSingleClientProvider(id, req, config)
    } catch (error) {
      if (req.signal?.aborted) throw error
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('全部 AI 接力通道均不可用')
}

/** 测试单棒连通性：优先经 /api/ai/complete（兼容 Vercel 环境变量与无 CORS），不可达时直连 */
export async function testRelayBatonClient(
  id: AllAiProviderId,
  settings: Pick<ApiSettings, 'geminiKey' | 'aiFallback'>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; model?: string; baton?: number; providerName?: string; message?: string }> {
  const config = normalizeAiFallback(settings.aiFallback)

  try {
    const res = await fetch('/api/ai/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        action: 'test',
        provider: id,
        geminiKey: settings.geminiKey.trim(),
        aiFallback: { ...config, enabled: true },
      }),
      signal,
    })
    if (res.ok && (res.headers.get('content-type') ?? '').includes('application/json')) {
      const data = (await res.json()) as {
        ok?: boolean
        model?: string
        baton?: number
        providerName?: string
        message?: string
      }
      return {
        ok: Boolean(data.ok),
        model: data.model,
        baton: data.baton ?? BATON_META[id].baton,
        providerName: data.providerName ?? BATON_META[id].name,
        message: data.message,
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      return { ok: false, message: '测试已取消' }
    }
    // 静态托管无后端时回退浏览器直连测试
    if (!(err instanceof TypeError)) {
      // fall through
    }
  }

  if (id === 'gemini') {
    const keys = collectClientGeminiKeys(settings)
    if (keys.length === 0) return { ok: false, message: '未配置 Gemini API Key' }
    for (const key of keys) {
      try {
        const res = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': key,
            },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: 'Reply OK' }] }],
              generationConfig: { maxOutputTokens: 16, temperature: 0 },
            }),
            signal,
          },
        )
        if (res.ok) {
          return {
            ok: true,
            model: 'gemini-2.5-flash',
            baton: 1,
            providerName: BATON_META.gemini.name,
          }
        }
        const detail = await res.text().catch(() => '')
        if (key === keys[keys.length - 1]) {
          return { ok: false, message: `Gemini HTTP ${res.status} ${detail.slice(0, 120)}` }
        }
      } catch (e) {
        if (key === keys[keys.length - 1]) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) }
        }
      }
    }
    return { ok: false, message: 'Gemini 测试失败' }
  }

  return testBackupProviderClient(id, config, signal)
}

export async function testBackupProviderClient(
  id: AiFallbackProviderId,
  config: AiFallbackConfig,
  signal?: AbortSignal,
): Promise<{ ok: boolean; model?: string; baton?: number; providerName?: string; message?: string }> {
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
    return {
      ok: true,
      model: res.model,
      baton: res.relay.baton,
      providerName: res.relay.providerName,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export function inferProviderFromModel(raw: string): AllAiProviderId {
  const lower = (raw ?? '').toLowerCase()
  for (const id of RELAY_ORDER) {
    if (lower.startsWith(`${id}/`)) return id
  }
  if (lower.includes('groq')) return 'groq'
  if (lower.includes('openrouter')) return 'openrouter'
  if (lower.includes('cerebras')) return 'cerebras'
  if (lower.includes('nvidia')) return 'nvidia'
  if (lower.includes('cloudflare')) return 'cloudflare'
  if (lower.includes('mistral')) return 'mistral'
  if (lower.includes('cohere') || lower.includes('command-')) return 'cohere'
  return 'gemini'
}

export function inferRelayFromModel(raw: string): RelayMeta {
  const providerId = inferProviderFromModel(raw)
  const meta = BATON_META[providerId]
  return {
    baton: meta.baton,
    providerId,
    providerName: meta.name,
    model: raw || 'gemini-2.5-flash',
  }
}

/**
 * 将 `provider/model` 格式化为可读模型名称
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
  if (lower.startsWith('cerebras/')) return `Cerebras · ${shortClean(text.slice(9))}`
  if (lower.startsWith('nvidia/')) return `NVIDIA · ${shortClean(text.slice(7))}`
  if (lower.startsWith('cloudflare/')) return `Cloudflare · ${shortClean(text.slice(11))}`
  if (lower.startsWith('mistral/')) return `Mistral · ${shortClean(text.slice(8))}`
  if (lower.startsWith('cohere/')) return `Cohere · ${shortClean(text.slice(7))}`
  if (lower.startsWith('custom1/')) return `自定义 #1 · ${text.slice(8)}`
  if (lower.startsWith('custom2/')) return `自定义 #2 · ${text.slice(8)}`
  if (lower.includes('2.5-pro')) return 'Gemini 2.5 Pro'
  if (lower.includes('2.5-flash-lite')) return 'Gemini 2.5 Flash-Lite'
  if (lower.includes('2.5-flash')) return 'Gemini 2.5 Flash'
  if (lower.includes('flash-latest')) return 'Gemini Flash Latest'
  return text
}

/** 生成统一角标文案：【本轮由：XXX 模型完成（第 N 棒）】 */
export function formatRelayBadge(input?: RelayMeta | string | null): string {
  if (!input) return '本轮由：本地引擎完成'
  const meta = typeof input === 'string' ? inferRelayFromModel(input) : input
  const label = formatBackupModelDisplay(meta.model) || meta.providerName
  return `本轮由：${label} 完成（第 ${meta.baton} 棒）`
}
