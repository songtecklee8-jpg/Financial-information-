import { useEffect, useRef, useState } from 'react'
import { KeyRound, Landmark, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'

import type { ApiSettings, ImpactDirection, MacroCycleAnalysis, MacroRates, NewsArticle } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { Panel } from '@/components/ui/Panel'
import { YieldCurveChart } from '@/components/ui/YieldCurveChart'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { aiRoute, modelDisplayName, runMacroCycleAnalysis } from '@/lib/gemini'
import { curveSpreads } from '@/lib/macro'

interface MacroPanelProps {
  macro: MacroRates
  onRefresh: () => void
  settings?: ApiSettings
  news?: NewsArticle[]
  hasGemini?: boolean
  onOpenSettings?: () => void
  onOpenBonds?: () => void
  className?: string
}

const BIAS_STYLE: Record<ImpactDirection, { label: string; tone: string }> = {
  bullish: { label: '偏多', tone: 'border-bull/35 bg-bull/10 text-bull' },
  bearish: { label: '偏空', tone: 'border-bear/35 bg-bear/10 text-bear' },
  neutral: { label: '中性', tone: 'border-gold/35 bg-gold/10 text-gold' },
}

function RateChip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'gold' | 'ice' | 'iris' | 'neutral'
}) {
  const TONE = {
    gold: 'text-gold',
    ice: 'text-ice',
    iris: 'text-iris',
    neutral: 'text-ink',
  } as const
  return (
    <div className="panel-flat min-w-0 px-2.5 py-2 transition-colors hover:border-line-2">
      <div className="truncate font-mono text-[10px] tracking-[0.08em] text-faint uppercase">{label}</div>
      <div className={cn('mt-1 font-mono text-[15px] leading-none font-medium', TONE[tone])}>
        {value.toFixed(2)}
        <span className="ml-0.5 text-[10px] text-faint">%</span>
      </div>
    </div>
  )
}

/** 利差对比：以 0 为中心的双向条（单位 bp） */
function SpreadRow({ label, value }: { label: string; value: number }) {
  const magnitude = Math.min(Math.abs(value) / 120, 1) * 50
  const positive = value >= 0
  return (
    <div>
      <div className="flex items-center justify-between font-mono text-[10.5px]">
        <span className="text-dim">{label}</span>
        <span className={cn('font-medium', positive ? 'text-bull' : 'text-bear')}>
          {positive ? '+' : ''}
          {value.toFixed(0)} bp
        </span>
      </div>
      <div className="relative mt-1 h-1.5 w-full rounded-full bg-line/70">
        <span className="absolute top-1/2 left-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-line-2" />
        <div
          className={cn(
            'absolute top-0 h-full rounded-full',
            positive ? 'left-1/2 bg-bull/70' : 'right-1/2 bg-bear/70',
          )}
          style={{ width: `${magnitude}%` }}
        />
      </div>
    </div>
  )
}

/** 宏观利率面板：美债 / MGS / OPR + 收益率曲线 + 利差对比 + Pro 深度跨市场宏观周期推演 */
export function MacroPanel({
  macro,
  onRefresh,
  settings,
  news = [],
  hasGemini = false,
  onOpenSettings,
  onOpenBonds,
  className,
}: MacroPanelProps) {
  const spreads = curveSpreads(macro)
  const [cycle, setCycle] = useState<MacroCycleAnalysis | null>(null)
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const runCycle = () => {
    if (!settings) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    runMacroCycleAnalysis(macro, news, settings.geminiKey, aiRoute(settings, 'pro'), controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setCycle(result)
      })
      .finally(() => {
        if (!controller.signal.aborted) setRunning(false)
      })
  }

  return (
    <Panel
      eyebrow="Macro / Rates"
      title="宏观利率环境"
      subtitle={`收益率曲线与政策利率 · 更新于 ${formatDateTime(macro.updatedAt)}`}
      className={className}
      actions={
        <>
          <Badge tone="neutral" title="基准口径：美国国债 / 马来西亚 MGS / BNM OPR">
            10Y 利差 {macro.spread10y.toFixed(2)}%
          </Badge>
          {onOpenBonds && (
            <button
              type="button"
              onClick={onOpenBonds}
              title="查看 MGS / MGII 发债拍卖日历"
              className="inline-flex items-center gap-1 rounded-lg border border-ice/40 bg-ice/10 px-2 py-1.5 font-mono text-[10px] text-ice transition hover:bg-ice/20"
            >
              <Landmark className="size-3" />
              MGS / MGII
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            title="刷新利率"
            className="inline-flex items-center gap-1 rounded-lg border border-line-2 px-2 py-1.5 font-mono text-[10.5px] text-dim transition hover:border-gold/50 hover:text-gold"
          >
            <RefreshCw className="size-3" />
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <YieldCurveChart macro={macro} />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <RateChip label="美国 2Y" value={macro.us2y} tone="gold" />
          <RateChip label="美国 10Y" value={macro.us10y} tone="gold" />
          <RateChip label="美国 30Y" value={macro.us30y} tone="gold" />
          <RateChip label="BNM OPR" value={macro.opr} tone="iris" />
          <RateChip label="MGS 3Y" value={macro.mgs3y} tone="ice" />
          <RateChip label="MGS 5Y" value={macro.mgs5y} tone="ice" />
          <RateChip label="MGS 10Y" value={macro.mgs10y} tone="ice" />
          <RateChip label="美债 10Y−MGS 10Y" value={macro.spread10y} tone="iris" />
        </div>

        <div>
          <div className="mb-2 font-mono text-[10.5px] font-medium tracking-[0.16em] text-gold/80 uppercase">
            利差对比（bp）
          </div>
          <div className="space-y-2.5">
            {spreads.map((spread) => (
              <SpreadRow key={spread.label} label={spread.label} value={spread.value} />
            ))}
          </div>
        </div>

        {/* 深度跨市场宏观周期推演（Pro 层级手动触发） */}
        {settings && (
          <div className="rounded-xl border border-iris/25 bg-iris/[0.04] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-mono text-[9.5px] tracking-[0.14em] text-iris uppercase">
                  Deep Macro Cycle · Pro
                </div>
                <div className="text-[12px] font-semibold text-ink">深度跨市场宏观周期推演</div>
              </div>
              <div className="flex items-center gap-1.5">
                {!hasGemini && onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-2 py-1 font-mono text-[10px] text-gold transition hover:bg-gold/20"
                  >
                    <KeyRound className="size-3" /> 配置 Key
                  </button>
                )}
                <button
                  type="button"
                  onClick={runCycle}
                  disabled={running}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[10.5px] transition',
                    running
                      ? 'cursor-not-allowed border-line bg-panel-2 text-faint'
                      : 'border-iris/45 bg-iris/15 text-iris hover:bg-iris/25',
                  )}
                >
                  {running ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                  {cycle ? '重新推演' : '运行 Pro 推演'}
                </button>
              </div>
            </div>

            {!cycle && !running && (
              <p className="mt-2 text-[11px] leading-relaxed text-dim">
                结合美债曲线、马来西亚 MGS / OPR 利差与实时财经头条，使用旗舰模型研判宏观周期定位与跨市场配置倾向。
              </p>
            )}

            {running && (
              <div className="flex items-center gap-2 py-4 font-mono text-[11px] text-iris">
                <LoaderCircle className="size-3.5 animate-spin" />
                正在调用深度推理模型推演美马跨市场宏观周期…
              </div>
            )}

            {cycle && !running && (
              <div className="mt-2.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <Badge tone="gold">{cycle.cyclePhase}</Badge>
                  {cycle.degraded ? (
                    <Badge tone="neutral">LOCAL ENGINE</Badge>
                  ) : (
                    <Badge tone="iris" title={`实际执行模型：${cycle.model}`}>
                      Powered by {modelDisplayName(cycle.model)}
                    </Badge>
                  )}
                </div>

                <p className="text-[12px] leading-snug font-medium text-ink">{cycle.headline}</p>
                <p className="text-[11px] leading-relaxed text-dim">{cycle.transmission}</p>

                <div className="rounded-lg border border-line bg-void/40 px-2.5 py-2">
                  <div className="font-mono text-[9.5px] tracking-[0.12em] text-gold/80 uppercase">
                    历史周期映射
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-dim">{cycle.historicalAnalogy}</p>
                </div>

                <div className="space-y-1.5">
                  {cycle.allocations.map((item) => {
                    const meta = BIAS_STYLE[item.bias]
                    return (
                      <div
                        key={item.asset}
                        className="flex items-start justify-between gap-2 rounded-lg border border-line bg-panel-2/60 px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium text-ink">{item.asset}</div>
                          <div className="text-[10.5px] leading-relaxed text-faint">{item.rationale}</div>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 rounded-full border px-2 py-[1px] font-mono text-[9.5px]',
                            meta.tone,
                          )}
                        >
                          {meta.label}
                        </span>
                      </div>
                    )
                  })}
                </div>

                <p className="border-t border-line/60 pt-2 text-[10.5px] leading-relaxed text-faint">
                  风控提示：{cycle.riskNote}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}
