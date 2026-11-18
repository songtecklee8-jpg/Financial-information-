import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartColumn, LoaderCircle, RefreshCw } from 'lucide-react'

import type { ApiSettings, Candle, Currency, IntervalKey, RangeKey } from '@/types'
import { Panel } from '@/components/ui/Panel'
import { Badge } from '@/components/ui/Badge'
import { useCandleSeries } from '@/hooks/useCandleSeries'
import { cn } from '@/lib/cn'
import { formatPercent, formatPrice, formatVolume } from '@/lib/format'
import {
  INTERVAL_META,
  INTERVAL_ORDER,
  RANGE_META,
  RANGE_ORDER,
  providerLabel,
} from '@/lib/market/registry'

interface CandleChartProps {
  symbol: string
  currency: Currency
  settings: ApiSettings
  className?: string
}

/** 默认走势跨度：近 5 年 */
const DEFAULT_RANGE: RangeKey = '5y'

const CHART_HEIGHT = 320
const VOLUME_HEIGHT = 54
const PAD = { top: 14, right: 60, bottom: 22, left: 10 }
const UP = 'var(--color-bull)'
const DOWN = 'var(--color-bear)'

function colorOf(candle: Candle): string {
  return candle.c >= candle.o ? UP : DOWN
}

/** 依据周期决定 X 轴时间标签格式 */
function axisLabel(ms: number, interval: IntervalKey): string {
  const date = new Date(ms)
  const pad = (value: number) => value.toString().padStart(2, '0')
  if (INTERVAL_META[interval].intraday) {
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  if (interval === '1w' || interval === '1mo') {
    return `${pad(date.getMonth() + 1)}/${date.getFullYear().toString().slice(2)}`
  }
  return `${date.getFullYear().toString().slice(2)}/${pad(date.getMonth() + 1)}`
}

function fullTime(ms: number, interval: IntervalKey): string {
  const date = new Date(ms)
  const pad = (value: number) => value.toString().padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (!INTERVAL_META[interval].intraday) return day
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 观测容器宽度，使 SVG 以 1:1 像素绘制（文字与描边不会被拉伸） */
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0)
    })
    observer.observe(element)
    setWidth(element.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2 py-1 font-mono text-[10.5px] whitespace-nowrap transition',
        active
          ? 'bg-gold/15 text-gold shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-gold)_45%,transparent)]'
          : 'text-dim hover:bg-panel-2 hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

export function CandleChart({ symbol, currency, settings, className }: CandleChartProps) {
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE)
  const [intervalKey, setIntervalKey] = useState<IntervalKey>(RANGE_META[DEFAULT_RANGE].defaultInterval)
  const [hover, setHover] = useState<number | null>(null)

  const [containerRef, width] = useElementWidth<HTMLDivElement>()
  const controller = useCandleSeries(symbol, range, intervalKey, settings)
  const candles = controller.series?.candles ?? []

  // 切换跨度时重置为合适的周期（用户仍可自由改回）
  const selectRange = (next: RangeKey) => {
    setRange(next)
    setIntervalKey(RANGE_META[next].defaultInterval)
    setHover(null)
  }

  const geometry = useMemo(() => {
    if (candles.length === 0 || width <= 0) return null
    const plotWidth = Math.max(40, width - PAD.left - PAD.right)
    const priceHeight = CHART_HEIGHT - PAD.top - PAD.bottom - VOLUME_HEIGHT
    const priceTop = PAD.top
    const volumeTop = priceTop + priceHeight + 12

    let low = Infinity
    let high = -Infinity
    let maxVolume = 0
    for (const candle of candles) {
      low = Math.min(low, candle.l)
      high = Math.max(high, candle.h)
      maxVolume = Math.max(maxVolume, candle.v)
    }
    const span = high - low || Math.max(high * 0.02, 1)
    const top = high + span * 0.04
    const bottom = low - span * 0.04
    const scale = top - bottom || 1
    const slot = plotWidth / candles.length
    const bodyWidth = Math.max(1, Math.min(slot * 0.68, 14))

    const yOf = (value: number) => priceTop + ((top - value) / scale) * priceHeight
    const xOf = (index: number) => PAD.left + slot * (index + 0.5)

    const gridValues: number[] = []
    for (let i = 0; i <= 4; i += 1) {
      gridValues.push(top - (scale * i) / 4)
    }

    const labelCount = Math.min(6, candles.length)
    const ticks: Array<{ x: number; label: string }> = []
    for (let i = 0; i < labelCount; i += 1) {
      const index = Math.round((i / Math.max(1, labelCount - 1)) * (candles.length - 1))
      const candle = candles[index]!
      ticks.push({ x: xOf(index), label: axisLabel(candle.t, intervalKey) })
    }

    return { plotWidth, priceHeight, priceTop, volumeTop, yOf, xOf, slot, bodyWidth, gridValues, ticks, maxVolume, top, bottom }
  }, [candles, width, intervalKey])

  const stats = useMemo(() => {
    if (candles.length === 0) return null
    const first = candles[0]!
    const last = candles[candles.length - 1]!
    const change = last.c - first.o
    return {
      first,
      last,
      change,
      changePercent: first.o ? (change / first.o) * 100 : 0,
    }
  }, [candles])

  const activeIndex = hover ?? (candles.length > 0 ? candles.length - 1 : 0)
  const activeCandle = candles[activeIndex]
  const up = stats ? stats.change >= 0 : true
  const origin = controller.series?.origin ?? 'baseline'

  return (
    <Panel
      eyebrow="Price Action / K 线"
      title="全周期走势图"
      subtitle={`${symbol} · 默认 5 年历史 · 数据源 ${providerLabel(controller.provider)}`}
      className={className}
      bodyClassName="p-0!"
      actions={
        <>
          {origin === 'live' ? (
            <Badge tone="bull" dot>
              LIVE
            </Badge>
          ) : (
            <Badge tone="neutral" title="未配置行情 Key 或请求受限，当前为高仿真合成序列">
              BASELINE
            </Badge>
          )}
          <button
            type="button"
            onClick={controller.refresh}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-[10.5px] text-dim transition hover:border-gold/50 hover:text-gold"
            title="刷新当前周期 K 线"
          >
            {controller.loading ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            刷新
          </button>
        </>
      }
    >
      {/* 周期与跨度切换 */}
      <div className="flex flex-col gap-1.5 border-b border-line/70 px-3 py-2 sm:px-3.5">
        <div className="flex items-center gap-1.5">
          <span className="w-8 shrink-0 font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">
            周期
          </span>
          <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto">
            {INTERVAL_ORDER.map((key) => (
              <SegmentButton key={key} active={intervalKey === key} onClick={() => setIntervalKey(key)}>
                {INTERVAL_META[key].label}
              </SegmentButton>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-8 shrink-0 font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">
            跨度
          </span>
          <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto">
            {RANGE_ORDER.map((key) => (
              <SegmentButton key={key} active={range === key} onClick={() => selectRange(key)}>
                {RANGE_META[key].label}
              </SegmentButton>
            ))}
          </div>
        </div>
      </div>

      {/* 图表主体 */}
      <div ref={containerRef} className="relative w-full px-2 pt-2">
        {geometry && candles.length > 0 ? (
          <svg
            width={width}
            height={CHART_HEIGHT}
            className="block max-w-full"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              const x = event.clientX - rect.left
              const index = Math.round((x - PAD.left) / geometry.slot - 0.5)
              setHover(Math.max(0, Math.min(candles.length - 1, index)))
            }}
          >
            {/* 价格网格与右侧刻度 */}
            {geometry.gridValues.map((value, index) => {
              const y = geometry.yOf(value)
              return (
                <g key={`grid-${index}`}>
                  <line
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={y}
                    y2={y}
                    stroke="var(--color-line)"
                    strokeWidth="1"
                    strokeDasharray="2 4"
                  />
                  <text
                    x={width - PAD.right + 6}
                    y={y + 3}
                    className="fill-[var(--color-faint)] font-mono text-[9.5px]"
                  >
                    {formatPrice(value, currency)}
                  </text>
                </g>
              )
            })}

            {/* 成交量 */}
            {candles.map((candle, index) => {
              const height = geometry.maxVolume > 0 ? (candle.v / geometry.maxVolume) * VOLUME_HEIGHT : 0
              return (
                <rect
                  key={`vol-${candle.t}`}
                  x={geometry.xOf(index) - geometry.bodyWidth / 2}
                  y={geometry.volumeTop + (VOLUME_HEIGHT - height)}
                  width={geometry.bodyWidth}
                  height={Math.max(0.5, height)}
                  fill={colorOf(candle)}
                  opacity={0.28}
                />
              )
            })}

            {/* K 线实体与影线 */}
            {candles.map((candle, index) => {
              const x = geometry.xOf(index)
              const color = colorOf(candle)
              const yOpen = geometry.yOf(candle.o)
              const yClose = geometry.yOf(candle.c)
              const bodyTop = Math.min(yOpen, yClose)
              const bodyHeight = Math.max(1, Math.abs(yClose - yOpen))
              return (
                <g key={`candle-${candle.t}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1={geometry.yOf(candle.h)}
                    y2={geometry.yOf(candle.l)}
                    stroke={color}
                    strokeWidth="1"
                  />
                  <rect
                    x={x - geometry.bodyWidth / 2}
                    y={bodyTop}
                    width={geometry.bodyWidth}
                    height={bodyHeight}
                    fill={color}
                  />
                </g>
              )
            })}

            {/* 最新价参考线 */}
            {stats && (
              <g>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={geometry.yOf(stats.last.c)}
                  y2={geometry.yOf(stats.last.c)}
                  stroke={up ? UP : DOWN}
                  strokeWidth="1"
                  strokeDasharray="4 3"
                  opacity="0.7"
                />
                <rect
                  x={width - PAD.right}
                  y={geometry.yOf(stats.last.c) - 8}
                  width={PAD.right - 4}
                  height={16}
                  rx="3"
                  fill={up ? UP : DOWN}
                />
                <text
                  x={width - PAD.right + 4}
                  y={geometry.yOf(stats.last.c) + 3.5}
                  className="fill-[var(--color-abyss)] font-mono text-[9.5px] font-semibold"
                >
                  {formatPrice(stats.last.c, currency)}
                </text>
              </g>
            )}

            {/* 十字光标 */}
            {hover !== null && candles[hover] && (
              <g>
                <line
                  x1={geometry.xOf(hover)}
                  x2={geometry.xOf(hover)}
                  y1={geometry.priceTop}
                  y2={geometry.volumeTop + VOLUME_HEIGHT}
                  stroke="var(--color-line-2)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={geometry.yOf(candles[hover]!.c)}
                  y2={geometry.yOf(candles[hover]!.c)}
                  stroke="var(--color-line-2)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              </g>
            )}

            {/* X 轴时间刻度 */}
            {geometry.ticks.map((tick, index) => (
              <text
                key={`tick-${index}`}
                x={tick.x}
                y={CHART_HEIGHT - 6}
                textAnchor="middle"
                className="fill-[var(--color-faint)] font-mono text-[9.5px]"
              >
                {tick.label}
              </text>
            ))}
          </svg>
        ) : (
          <div className="flex h-[320px] items-center justify-center text-faint">
            <LoaderCircle className="size-5 animate-spin" />
          </div>
        )}
      </div>

      {/* 读数与统计 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line/70 px-3.5 py-2 font-mono text-[10.5px]">
        {activeCandle && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-dim">
            <span className="text-faint">{fullTime(activeCandle.t, intervalKey)}</span>
            <span>
              开 <span className="text-ink">{formatPrice(activeCandle.o, currency)}</span>
            </span>
            <span>
              高 <span className="text-ink">{formatPrice(activeCandle.h, currency)}</span>
            </span>
            <span>
              低 <span className="text-ink">{formatPrice(activeCandle.l, currency)}</span>
            </span>
            <span>
              收 <span className="text-ink">{formatPrice(activeCandle.c, currency)}</span>
            </span>
            <span>
              量 <span className="text-ink">{formatVolume(activeCandle.v)}</span>
            </span>
          </span>
        )}
        {stats && (
          <span className="ml-auto flex items-center gap-3">
            <span className="text-faint">
              区间{' '}
              <span className={up ? 'text-bull' : 'text-bear'}>
                {formatPercent(stats.changePercent, { signed: true })}
              </span>
            </span>
            <span className="hidden items-center gap-1 text-faint sm:flex">
              <ChartColumn className="size-3" />
              {candles.length} 根 · {INTERVAL_META[intervalKey].label}
              {controller.factor > 1 && controller.sourceInterval
                ? `（由 ${INTERVAL_META[controller.sourceInterval].label} 聚合）`
                : ''}
            </span>
          </span>
        )}
      </div>
    </Panel>
  )
}
