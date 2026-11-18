import type { Currency } from '@/types'

const CURRENCY_SYMBOL: Record<Currency | 'USD' | 'MYR', string> = {
  USD: '$',
  MYR: 'RM',
}

export function currencySymbol(currency: Currency | string): string {
  return CURRENCY_SYMBOL[currency as Currency] ?? ''
}

/** 价格：按币种加前缀，自动选择小数位 */
export function formatPrice(value: number | null | undefined, currency: Currency | string = 'USD'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const digits = Math.abs(value) >= 100 ? 2 : Math.abs(value) >= 1 ? 3 : 4
  return `${currencySymbol(currency)}${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  })}`
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** 百分比，默认带正负号与 1~2 位小数 */
export function formatPercent(
  value: number | null | undefined,
  options: { digits?: number; signed?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const { digits = 2, signed = false } = options
  const sign = signed && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

/** 大额数字压缩：1.23T / 45.6B / 987.6M / 12.3K */
export function formatCompact(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const units: Array<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = value / size
      return `${scaled.toFixed(digits)}${suffix}`
    }
  }
  return value.toFixed(digits)
}

export function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return formatCompact(value, 1)
}

export function formatRatio(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A'
  if (value <= 0) return 'N/A'
  return `${value.toFixed(digits)}x`
}

/** 时钟：09:41:07 */
export function formatClock(date: Date, timeZone?: string): string {
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone,
  })
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** 相对时间：刚刚 / 12 分钟前 / 3 小时前 / 2 天前 */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Math.max(0, now - t)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 把任意数值安全地降级为有限数字 */
export function safeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : Number(value)
  return Number.isFinite(n) ? n : fallback
}
