/** 引擎请求错误：携带 HTTP 状态，便于故障转移内核判断是否熔断 */
export class ProviderHttpError extends Error {
  readonly status: number
  readonly url: string
  constructor(status: number, url: string, message?: string) {
    super(message ?? `HTTP ${status}`)
    this.name = 'ProviderHttpError'
    this.status = status
    this.url = url
  }
}

/** 限流 / 配额耗尽 */
export class ProviderRateLimitError extends ProviderHttpError {
  constructor(url: string, message?: string) {
    super(429, url, message ?? '触发速率限制或配额耗尽')
    this.name = 'ProviderRateLimitError'
  }
}

export class ProviderNoKeyError extends Error {
  constructor(message = '未配置 API Key') {
    super(message)
    this.name = 'ProviderNoKeyError'
  }
}

export function isRateLimitError(error: unknown): boolean {
  if (error instanceof ProviderRateLimitError) return true
  if (error instanceof ProviderHttpError) return error.status === 429
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /rate limit|too many requests|quota|limit reached|429/i.test(message)
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message))
}

/** 把任意异常转成适合展示在状态灯上的一句话 */
export function describeError(error: unknown): string {
  if (error instanceof ProviderNoKeyError) return '未配置 Key'
  if (error instanceof ProviderHttpError) {
    if (error.status === 429) return '限流 / 配额耗尽'
    if (error.status === 401 || error.status === 403) return 'Key 无效或无权限'
    if (error.status === 404) return '该标的无数据'
    return `请求失败（HTTP ${error.status}）`
  }
  if (error instanceof Error) {
    if (/timeout|timed out/i.test(error.message)) return '请求超时'
    if (/Failed to fetch|NetworkError|network/i.test(error.message)) return '网络不可达'
    if (/JSON|Unexpected token/i.test(error.message)) return '返回格式异常'
    return error.message.slice(0, 60)
  }
  return '未知错误'
}
