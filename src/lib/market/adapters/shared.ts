import type { IntervalKey, RangeKey } from '@/types'
import { ProviderNoKeyError } from '@/lib/market/errors'
import { INTERVAL_META, RANGE_META } from '@/lib/market/registry'
import type { ProviderCtx } from '@/lib/market/registry'

/** 适配器共用小工具 */

const MS_PER_DAY = 86_400_000

/** `.KL` 结尾视为马币，其余为美元 */
export function inferCurrency(symbol: string): 'USD' | 'MYR' {
  return symbol.endsWith('.KL') ? 'MYR' : 'USD'
}

/** 毫秒时间戳 → YYYY-MM-DD */
export function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function isoNow(): string {
  return new Date().toISOString()
}

/** 依据区间与周期估算需要请求的 K 线根数，上限 5000 */
export function barCount(range: RangeKey, interval: IntervalKey): number {
  const meta = RANGE_META[range]
  const days = meta.days === 0 ? 4000 : meta.days
  const count = Math.ceil((days * MS_PER_DAY) / INTERVAL_META[interval].ms)
  return Math.min(5000, Math.max(1, count))
}

/** 校验并返回 Key；缺失时抛出 ProviderNoKeyError */
export function ensureKey(ctx: ProviderCtx, providerLabel: string): string {
  if (!ctx.apiKey.trim()) throw new ProviderNoKeyError(`未配置 ${providerLabel} Key`)
  return ctx.apiKey
}
