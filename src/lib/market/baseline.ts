import type { Candle, IntervalKey, RangeKey } from '@/types'
import { hashString, mulberry32 } from '@/lib/prng'
import { INTERVAL_META, RANGE_META } from '@/lib/market/registry'
import { baselineQuote } from '@/lib/universe'

/**
 * 无可用行情引擎时的高仿真 K 线兜底。
 * 用确定性伪随机生成一段随机游走，并收束到基准收盘价，保证图表永不空白。
 */

const MAX_BARS = 1400
const DAY_MS = 86_400_000

export function syntheticCandles(
  symbol: string,
  range: RangeKey,
  interval: IntervalKey,
  now = Date.now(),
): Candle[] {
  const meta = RANGE_META[range]
  const spanMs = meta.days === 0 ? 12 * 365 * DAY_MS : meta.days * DAY_MS
  const baseStep = INTERVAL_META[interval].ms
  const rawCount = Math.max(30, Math.ceil(spanMs / baseStep))
  const count = Math.min(MAX_BARS, rawCount)
  // 当目标根数超过上限时，拉大时间步长，使序列仍能覆盖整个区间
  const step = rawCount > MAX_BARS ? Math.floor(spanMs / count) : baseStep

  const quote = baselineQuote(symbol)
  const normalized = symbol.trim().toUpperCase()
  const rand = mulberry32(hashString(`${normalized}:candles:${range}:${interval}`))

  // 每日波动率约 1.1%，按时间步长缩放
  const vol = 0.011 * Math.sqrt(step / DAY_MS)
  const end = Math.floor(now / step) * step

  // 从终点价格向前做随机游走，再翻转，得到一条收束于当前价的走势
  const closes: number[] = []
  let price = quote.price
  for (let i = 0; i < count; i += 1) {
    closes.push(price)
    const shock = (rand() - 0.5) * 2 * vol
    price = Math.max(price * (1 - shock), quote.price * 0.12)
  }
  closes.reverse()

  const candles: Candle[] = []
  for (let i = 0; i < count; i += 1) {
    const close = closes[i] ?? quote.price
    const open = i === 0 ? close * (1 - (rand() - 0.5) * vol) : (closes[i - 1] ?? close)
    const high = Math.max(open, close) * (1 + rand() * vol * 0.6)
    const low = Math.min(open, close) * (1 - rand() * vol * 0.6)
    candles.push({
      t: end - (count - 1 - i) * step,
      o: open,
      h: high,
      l: low,
      c: close,
      v: quote.averageVolume * (0.45 + rand() * 1.1),
    })
  }
  return candles
}
