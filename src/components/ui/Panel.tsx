import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

interface PanelProps {
  /** 面板左上角的等宽小标签，如 "EQUITY / VALUATION" */
  eyebrow?: string
  title?: ReactNode
  subtitle?: ReactNode
  /** 右上角操作区 */
  actions?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}

export function Panel({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  const hasHeader = Boolean(eyebrow || title || subtitle || actions)
  return (
    <section className={cn('panel hairline-top flex min-w-0 flex-col', className)}>
      {hasHeader && (
        <header className="flex items-start justify-between gap-3 border-b border-line/70 px-3.5 py-2.5 sm:px-4">
          <div className="min-w-0">
            {eyebrow && (
              <div className="font-mono text-[10px] font-medium tracking-[0.18em] text-gold/80 uppercase">
                {eyebrow}
              </div>
            )}
            {title && (
              <h2 className="truncate text-[13px] font-semibold tracking-wide text-ink sm:text-sm">
                {title}
              </h2>
            )}
            {subtitle && <div className="mt-0.5 text-[11px] text-faint">{subtitle}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn('min-w-0 flex-1 p-3.5 sm:p-4', bodyClassName)}>{children}</div>
    </section>
  )
}
