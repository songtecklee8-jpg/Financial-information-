import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export type BadgeTone = 'gold' | 'bull' | 'bear' | 'ice' | 'iris' | 'neutral'

const TONES: Record<BadgeTone, string> = {
  gold: 'border-gold/35 bg-gold/10 text-gold',
  bull: 'border-bull/35 bg-bull/10 text-bull',
  bear: 'border-bear/35 bg-bear/10 text-bear',
  ice: 'border-ice/35 bg-ice/10 text-ice',
  iris: 'border-iris/35 bg-iris/10 text-iris',
  neutral: 'border-line-2 bg-panel-3 text-dim',
}

interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  className?: string
  /** 是否显示左侧状态圆点 */
  dot?: boolean
  title?: string
}

export function Badge({ tone = 'neutral', children, className, dot, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] font-mono text-[10px] leading-none font-medium tracking-[0.08em] uppercase',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  )
}

/** 数据来源徽章：LIVE / BASELINE */
export function OriginBadge({ origin, className }: { origin: 'live' | 'baseline'; className?: string }) {
  return origin === 'live' ? (
    <Badge tone="bull" dot className={className} title="数据来自 Twelve Data 实时接口">
      LIVE
    </Badge>
  ) : (
    <Badge tone="neutral" className={className} title="未配置 API Key 或请求受限，当前展示终端内置高仿真基准数据">
      BASELINE
    </Badge>
  )
}
