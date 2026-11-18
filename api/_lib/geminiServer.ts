/**
 * APEX Terminal — 服务端 Gemini 调用层。
 *
 * 后台任务（新闻预翻译 / 摘要 / 五大资产推演）统一走本模块：
 * 默认使用 gemini-2.5-flash-lite 以最大化节省免费配额，遇到 429 / 不可用时
 * 自动向更稳的模型无缝降级，绝不中断后台同步。
 */

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

/**
 * 依次尝试模型链；遇到 API Key 无效立即抛出，其余（429 / 5xx / 网络）继续向下降级。
 */
export async function generateServer(options: GenerateServerOptions): Promise<ServerGeneration> {
  if (!options.apiKey) throw new Error('未配置 GEMINI_API_KEY')
  const chain = options.chain ?? deriveChain(options.model ?? SERVER_LITE_MODEL)
  let lastError: unknown = null
  for (const model of chain) {
    try {
      return await callModel(options, model)
    } catch (error) {
      lastError = error
      const status = (error as { status?: number }).status
      if (status === 400 || status === 401 || status === 403) throw error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Gemini 全部模型均不可用')
}
