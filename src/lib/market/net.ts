import { ProviderHttpError, ProviderRateLimitError } from '@/lib/market/errors'
import type { ProviderCtx } from '@/lib/market/registry'

/**
 * 浏览器端网络层：直连 + 公共 CORS 网关回退链。
 *
 * 适配器只管拼 URL，网络与跨域代理统一收敛在此模块，方便引擎层直接注入 ctx。
 */

export interface RequestOptions {
  signal?: AbortSignal
  headers?: Record<string, string>
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 9000

type UrlBuilder = (url: string) => string

/** 依次尝试：直连 → allorigins → corsproxy → codetabs */
const GATEWAYS: UrlBuilder[] = [
  (url) => url,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
]

async function fetchWithTimeout(url: string, opts: RequestOptions): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const external = opts.signal
  const onAbort = (): void => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onAbort)
  }
  try {
    return await fetch(url, { signal: controller.signal, headers: opts.headers })
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', onAbort)
  }
}

/** 依次尝试直连与各公共网关，全部失败才抛出最后一个错误 */
export async function requestText(url: string, opts: RequestOptions = {}): Promise<string> {
  let lastError: unknown = null
  for (const build of GATEWAYS) {
    try {
      const response = await fetchWithTimeout(build(url), opts)
      if (response.status === 429) throw new ProviderRateLimitError(url)
      if (!response.ok) throw new ProviderHttpError(response.status, url)
      return await response.text()
    } catch (error) {
      // 外部 signal 主动中止：立即向上抛出，不再尝试后续网关
      if (opts.signal?.aborted) throw error
      lastError = error
    }
  }
  throw lastError ?? new Error(`请求失败：${url}`)
}

export async function requestJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const body = await requestText(url, opts)
  try {
    return JSON.parse(body) as T
  } catch {
    throw new Error('返回格式异常')
  }
}

function headersToRecord(headers?: HeadersInit): Record<string, string> | undefined {
  if (!headers) return undefined
  const out: Record<string, string> = {}
  new Headers(headers).forEach((value, key) => {
    out[key] = value
  })
  return out
}

export function createProviderCtx(opts: {
  apiKey: string
  secretKey: string
  signal: AbortSignal
}): ProviderCtx {
  const { apiKey, secretKey, signal } = opts
  return {
    apiKey,
    secretKey,
    signal,
    json: <T>(url: string, init?: RequestInit): Promise<T> =>
      requestJson<T>(url, {
        signal: init?.signal ?? signal,
        headers: headersToRecord(init?.headers),
      }),
    text: (url: string, init?: RequestInit): Promise<string> =>
      requestText(url, {
        signal: init?.signal ?? signal,
        headers: headersToRecord(init?.headers),
      }),
  }
}
