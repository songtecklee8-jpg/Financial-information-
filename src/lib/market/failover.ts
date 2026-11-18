import type {
  ApiSettings,
  Candle,
  FundamentalsPatch,
  IntervalKey,
  ProviderId,
  ProviderStatus,
  QuoteSnapshot,
  RangeKey,
} from '@/types'
import { ADAPTERS } from '@/lib/market/adapters'
import { createProviderCtx } from '@/lib/market/net'
import type { ProviderCtx } from '@/lib/market/registry'
import {
  LONG_HISTORY_CHAIN,
  PROVIDER_IDS,
  PROVIDER_META,
  RANGE_META,
  aggregateCandles,
  chainFor,
  isProviderConfigured,
  pickSourceInterval,
} from '@/lib/market/registry'
import type { Instrument } from '@/lib/market/symbols'
import { parseInstrument } from '@/lib/market/symbols'
import { describeError, isAbortError, isRateLimitError } from '@/lib/market/errors'

/**
 * 多引擎故障转移内核。
 *
 * 按链路顺序依次尝试各引擎：命中限流 / 配额耗尽 / 连续失败者进入冷却，本次请求
 * 立即「毫秒级」切到下一个引擎；只要链路里还有一个可用引擎，就不会向 UI 抛白屏。
 * 健康状态通过 subscribeStatuses 订阅，供「API 设置」面板的指示灯实时展示。
 */

const RATE_LIMIT_COOLDOWN_MS = 45_000
const FAILURE_COOLDOWN_MS = 30_000
const FAILURE_THRESHOLD = 3

// ---------------------------------------------------------------------------
// 健康状态存储（供 useSyncExternalStore 订阅）
// ---------------------------------------------------------------------------

const statuses = new Map<ProviderId, ProviderStatus>()
for (const id of PROVIDER_IDS) {
  statuses.set(id, { id, health: 'unknown', failures: 0, requests: 0 })
}

let cached: ProviderStatus[] = PROVIDER_IDS.map((id) => statuses.get(id)!)
const listeners = new Set<() => void>()

function emit(): void {
  cached = PROVIDER_IDS.map((id) => ({ ...statuses.get(id)! }))
  for (const listener of listeners) listener()
}

function patchStatus(id: ProviderId, partial: Partial<ProviderStatus>): void {
  const current = statuses.get(id)!
  statuses.set(id, { ...current, ...partial })
  emit()
}

export function getStatuses(): ProviderStatus[] {
  return cached
}

export function subscribeStatuses(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 重置全部引擎的健康状态（清空密钥后调用） */
export function resetStatuses(): void {
  for (const id of PROVIDER_IDS) {
    statuses.set(id, { id, health: 'unknown', failures: 0, requests: 0 })
  }
  emit()
}

// ---------------------------------------------------------------------------
// 链路编排
// ---------------------------------------------------------------------------

function supportsMarket(id: ProviderId, instrument: Instrument): boolean {
  const { caps } = PROVIDER_META[id]
  if (instrument.assetClass === 'crypto') return caps.crypto
  return instrument.market === 'BURSA' ? caps.bursa : caps.us
}

/** 长历史区间（≥5 年）时，把历史深度足够的引擎前置 */
function orderedChain(instrument: Instrument, range: RangeKey | null): ProviderId[] {
  const base = chainFor({ assetClass: instrument.assetClass, market: instrument.market })
  if (!range) return base
  const meta = RANGE_META[range]
  const needYears = meta.days === 0 ? 40 : meta.days / 365
  if (needYears < 5) return base
  const capable = base.filter((id) => PROVIDER_META[id].caps.historyYears >= needYears)
  const rest = base.filter((id) => PROVIDER_META[id].caps.historyYears < needYears)
  return capable.length > 0 ? [...capable, ...rest] : base
}

interface ChainOptions<T> {
  chain: ProviderId[]
  settings: ApiSettings
  signal: AbortSignal
  /** 该引擎是否具备完成本次请求的能力（不支持的直接跳过，不计失败） */
  supports: (id: ProviderId) => boolean
  build: (id: ProviderId, ctx: ProviderCtx) => Promise<T>
}

interface ChainResult<T> {
  value: T
  provider: ProviderId
  /** 实际尝试过的引擎顺序（最后一个为成功者） */
  trail: ProviderId[]
}

async function runChain<T>(options: ChainOptions<T>): Promise<ChainResult<T>> {
  const { settings, signal, supports, build } = options
  const chain = options.chain.filter(supports)
  const now = Date.now()

  const ready: ProviderId[] = []
  const cooling: ProviderId[] = []

  for (const id of chain) {
    const config = settings.providers?.[id]
    const configured = isProviderConfigured(id, config?.apiKey ?? '', config?.secretKey ?? '')
    if (!configured) {
      if (PROVIDER_META[id].requiresKey) {
        patchStatus(id, { health: 'no-key', message: '未配置 Key' })
      }
      continue
    }
    const status = statuses.get(id)!
    if (status.cooldownUntil && status.cooldownUntil > now) {
      cooling.push(id)
      patchStatus(id, { health: 'cooldown', message: `冷却中（${Math.ceil((status.cooldownUntil - now) / 1000)}s）` })
      continue
    }
    ready.push(id)
  }

  // 全部在冷却 → 取冷却最早者做一次半开探测，避免整条链路被锁死
  let order = ready
  if (order.length === 0 && cooling.length > 0) {
    order = [...cooling].sort(
      (a, b) => (statuses.get(a)!.cooldownUntil ?? 0) - (statuses.get(b)!.cooldownUntil ?? 0),
    )
  }

  if (order.length === 0) {
    throw new Error('暂无可用的行情引擎，请在「API 设置」中配置至少一个数据源')
  }

  const trail: ProviderId[] = []
  let lastError: unknown = null

  for (const id of order) {
    const config = settings.providers?.[id]
    const ctx = createProviderCtx({
      apiKey: config?.apiKey ?? '',
      secretKey: config?.secretKey ?? '',
      signal,
    })
    trail.push(id)
    const started = Date.now()
    try {
      const value = await build(id, ctx)
      const current = statuses.get(id)!
      patchStatus(id, {
        health: 'ok',
        message: undefined,
        latencyMs: Date.now() - started,
        failures: 0,
        cooldownUntil: undefined,
        checkedAt: new Date().toISOString(),
        requests: current.requests + 1,
      })
      return { value, provider: id, trail }
    } catch (error) {
      // 用户主动中止：不算引擎故障，直接向上抛
      if (isAbortError(error) || signal.aborted) throw error
      lastError = error
      const current = statuses.get(id)!
      const failures = current.failures + 1
      const rateLimited = isRateLimitError(error)
      const cooldownMs = rateLimited
        ? RATE_LIMIT_COOLDOWN_MS
        : failures >= FAILURE_THRESHOLD
          ? FAILURE_COOLDOWN_MS
          : 0
      patchStatus(id, {
        health: rateLimited ? 'rate-limited' : 'error',
        message: describeError(error),
        failures,
        cooldownUntil: cooldownMs > 0 ? Date.now() + cooldownMs : current.cooldownUntil,
        checkedAt: new Date().toISOString(),
      })
      // 继续尝试下一个引擎
    }
  }

  throw lastError ?? new Error('全部行情引擎均不可用')
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

export interface FailoverQuote {
  snapshot: QuoteSnapshot
  provider: ProviderId
  trail: ProviderId[]
}

export async function fetchQuote(
  input: string,
  settings: ApiSettings,
  signal: AbortSignal,
): Promise<FailoverQuote> {
  const instrument = parseInstrument(input)
  const chain = orderedChain(instrument, null)
  const { value, provider, trail } = await runChain<QuoteSnapshot>({
    chain,
    settings,
    signal,
    supports: (id) => {
      const adapter = ADAPTERS[id]
      return Boolean(adapter.quote) && PROVIDER_META[id].caps.quote && supportsMarket(id, instrument)
    },
    build: (id, ctx) => ADAPTERS[id].quote!(instrument.symbol, ctx),
  })
  return { snapshot: value, provider, trail }
}

export interface FailoverCandles {
  candles: Candle[]
  provider: ProviderId
  /** 实际请求的源周期（可能比目标更细，由 factor 聚合而来） */
  sourceInterval: IntervalKey
  factor: number
  trail: ProviderId[]
}

interface RawCandles {
  candles: Candle[]
  sourceInterval: IntervalKey
  factor: number
}

export async function fetchCandles(
  input: string,
  range: RangeKey,
  interval: IntervalKey,
  settings: ApiSettings,
  signal: AbortSignal,
): Promise<FailoverCandles> {
  const instrument = parseInstrument(input)
  const chain = orderedChain(instrument, range)
  const { value, provider, trail } = await runChain<RawCandles>({
    chain,
    settings,
    signal,
    supports: (id) => {
      const adapter = ADAPTERS[id]
      if (!adapter.candles || !PROVIDER_META[id].caps.candles || !supportsMarket(id, instrument)) {
        return false
      }
      return pickSourceInterval(PROVIDER_META[id].caps.intervals, interval) !== null
    },
    build: async (id, ctx) => {
      const pick = pickSourceInterval(PROVIDER_META[id].caps.intervals, interval)!
      const raw = await ADAPTERS[id].candles!(instrument.symbol, range, pick.source, ctx)
      return {
        candles: pick.factor > 1 ? aggregateCandles(raw, pick.factor) : raw,
        sourceInterval: pick.source,
        factor: pick.factor,
      }
    },
  })
  return {
    candles: value.candles,
    provider,
    sourceInterval: value.sourceInterval,
    factor: value.factor,
    trail,
  }
}

export interface FailoverFundamentals {
  patch: FundamentalsPatch
  provider: ProviderId
  trail: ProviderId[]
}

/** 拉取基本面补丁；全部引擎失败时返回 null（由调用方沿用基准值） */
export async function fetchFundamentals(
  input: string,
  settings: ApiSettings,
  signal: AbortSignal,
): Promise<FailoverFundamentals | null> {
  const instrument = parseInstrument(input)
  const chain = orderedChain(instrument, null)
  try {
    const { value, provider, trail } = await runChain<FundamentalsPatch>({
      chain,
      settings,
      signal,
      supports: (id) =>
        Boolean(ADAPTERS[id].fundamentals) &&
        PROVIDER_META[id].caps.fundamentals &&
        supportsMarket(id, instrument),
      build: (id, ctx) => ADAPTERS[id].fundamentals!(instrument.symbol, ctx),
    })
    return { patch: value, provider, trail }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 连通性测试（供「API 设置」面板的「测试」按钮调用）
// ---------------------------------------------------------------------------

function probeSymbol(id: ProviderId): string {
  const { caps } = PROVIDER_META[id]
  if (caps.us) return 'AAPL'
  if (caps.crypto) return 'BTCUSDT'
  return 'AAPL'
}

export async function testProvider(
  id: ProviderId,
  settings: ApiSettings,
  signal: AbortSignal,
): Promise<ProviderStatus> {
  const config = settings.providers?.[id]
  if (!isProviderConfigured(id, config?.apiKey ?? '', config?.secretKey ?? '')) {
    patchStatus(id, { health: 'no-key', message: '未配置 Key' })
    return statuses.get(id)!
  }

  patchStatus(id, { health: 'testing', message: '正在测试连通性…' })
  const ctx = createProviderCtx({
    apiKey: config?.apiKey ?? '',
    secretKey: config?.secretKey ?? '',
    signal,
  })
  const adapter = ADAPTERS[id]
  const symbol = probeSymbol(id)
  const started = Date.now()

  try {
    if (adapter.quote) {
      await adapter.quote(symbol, ctx)
    } else if (adapter.candles) {
      await adapter.candles(symbol, '1mo', '1d', ctx)
    } else if (adapter.fundamentals) {
      await adapter.fundamentals(symbol, ctx)
    }
    patchStatus(id, {
      health: 'ok',
      message: '连通正常',
      latencyMs: Date.now() - started,
      failures: 0,
      cooldownUntil: undefined,
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      patchStatus(id, { health: 'unknown', message: '测试已取消' })
    } else {
      const rateLimited = isRateLimitError(error)
      patchStatus(id, {
        health: rateLimited ? 'rate-limited' : 'error',
        message: describeError(error),
        checkedAt: new Date().toISOString(),
      })
    }
  }
  return statuses.get(id)!
}

/** 当前已配置（可参与故障转移）的引擎数量 */
export function configuredProviderCount(settings: ApiSettings): number {
  return PROVIDER_IDS.filter((id) =>
    isProviderConfigured(id, settings.providers?.[id]?.apiKey ?? '', settings.providers?.[id]?.secretKey ?? ''),
  ).length
}

/** 长历史能力最强的链路（用于 UI 说明） */
export const HISTORY_CHAIN: ProviderId[] = LONG_HISTORY_CHAIN
