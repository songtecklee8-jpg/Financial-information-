import { useId } from 'react'

import { cn } from '@/lib/cn'

interface SparklineProps {
  data: number[]
  /** 以该值为基准线（通常是昨收），用于判定涨跌配色 */
  baseline?: number
  className?: string
  strokeWidth?: number
  showArea?: boolean
  showBaseline?: boolean
  /** 覆盖自动配色 */
  tone?: 'bull' | 'bear' | 'gold' | 'ice'
  height?: number
}

const TONE_STROKE: Record<string, string> = {
  bull: 'var(--color-bull)',
  bear: 'var(--color-bear)',
  gold: 'var(--color-gold)',
  ice: 'var(--color-ice)',
}

/** 轻量 SVG 走势线，无第三方图表依赖 */
export function Sparkline({
  data,
  baseline,
  className,
  strokeWidth = 1.6,
  showArea = true,
  showBaseline = false,
  tone,
  height = 48,
}: SparklineProps) {
  const gradientId = useId().replace(/[:]/g, '')
  const points = data.filter((value) => Number.isFinite(value))
  if (points.length < 2) {
    return <div className={cn('h-12 w-full', className)} />
  }

  const width = 300
  const h = height
  const min = Math.min(...points, ...(showBaseline && baseline ? [baseline] : []))
  const max = Math.max(...points, ...(showBaseline && baseline ? [baseline] : []))
  const span = max - min || 1
  const pad = 3

  const toX = (index: number) => (index / (points.length - 1)) * width
  const toY = (value: number) => h - pad - ((value - min) / span) * (h - pad * 2)

  const line = points.map((value, index) => `${toX(index).toFixed(2)},${toY(value).toFixed(2)}`).join(' ')
  const area = `${toX(0).toFixed(2)},${h} ${line} ${toX(points.length - 1).toFixed(2)},${h}`

  const last = points[points.length - 1] ?? 0
  const reference = baseline ?? points[0] ?? last
  const resolvedTone = tone ?? (last >= reference ? 'bull' : 'bear')
  const stroke = TONE_STROKE[resolvedTone] ?? TONE_STROKE.gold

  return (
    <svg
      viewBox={`0 0 ${width} ${h}`}
      preserveAspectRatio="none"
      className={cn('w-full', className)}
      style={{ height: h }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {showBaseline && baseline !== undefined && (
        <line
          x1="0"
          x2={width}
          y1={toY(baseline)}
          y2={toY(baseline)}
          stroke="var(--color-line-2)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      )}
      {showArea && <polygon points={area} fill={`url(#${gradientId})`} />}
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={toX(points.length - 1)} cy={toY(last)} r="2.4" fill={stroke} />
    </svg>
  )
}
