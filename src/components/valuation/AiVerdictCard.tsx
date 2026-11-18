import { AlertTriangle, Loader2, Lock, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'

import type { AiVerdict, Security } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { Gauge } from '@/components/ui/Gauge'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { VERDICT_META } from '@/lib/valuation'

interface AiVerdictCardProps {
  security: Security
  /** 已解析好的裁决（Gemini 结果或本地量化兜底） */
  verdict: AiVerdict
  /** 是否为 Gemini 实时生成 */
  isAi: boolean
  running: boolean
  error: string | null
  hasGemini: boolean
  onRun: () => void
  onOpenSettings: () => void
}

/** AI 综合价值裁决卡片 —— 诊断面板的头部结论区 */
export function AiVerdictCard({
  security,
  verdict,
  isAi,
  running,
  error,
  hasGemini,
  onRun,
  onOpenSettings,
}: AiVerdictCardProps) {
  const meta = VERDICT_META[verdict.verdict]

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border bg-gradient-to-br px-3.5 py-3.5 sm:px-4',
        meta.ring,
        meta.bg,
      )}
    >
      <div className="pointer-events-none absolute -top-16 -right-12 size-44 rounded-full bg-gold/10 blur-3xl" />

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-2 bg-void/60">
            <Sparkles className={cn('size-4', isAi ? 'text-gold text-glow-gold' : 'text-dim')} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] tracking-[0.18em] text-faint uppercase">
                AI 综合价值裁决
              </span>
              <Badge tone={isAi ? 'gold' : 'neutral'} dot={isAi}>
                {isAi ? `Gemini · ${verdict.model}` : '本地量化引擎'}
              </Badge>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'rounded-md border px-2 py-1 font-mono text-[12.5px] font-bold tracking-[0.1em]',
                  meta.ring,
                  meta.bg,
                  meta.text,
                )}
              >
                {meta.label}
              </span>
              <span className={cn('text-[13px] font-semibold', meta.text)}>{meta.zh}</span>
            </div>
            <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-ink">{verdict.headline}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center">
          <Gauge value={verdict.score} size={120} label="VALUE SCORE" sublabel={meta.zh} />
          <span className="mt-1 font-mono text-[10px] text-faint">0-100 综合性价比</span>
        </div>
      </div>

      {verdict.thesis && (
        <p className="relative mt-3 border-t border-line/60 pt-3 text-[12px] leading-relaxed text-dim">
          {verdict.thesis}
        </p>
      )}

      <div className="relative mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-bull/20 bg-bull/[0.05] px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="size-3.5 text-bull" />
            <span className="font-mono text-[10px] tracking-[0.14em] text-bull uppercase">
              看多理由
            </span>
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {(verdict.bullish.length > 0 ? verdict.bullish : ['暂无明确的多头论据。']).map(
              (item, index) => (
                <li key={index} className="flex gap-1.5 text-[11.5px] leading-relaxed text-dim">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-bull" />
                  <span>{item}</span>
                </li>
              ),
            )}
          </ul>
        </div>

        <div className="rounded-lg border border-bear/20 bg-bear/[0.05] px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <TrendingDown className="size-3.5 text-bear" />
            <span className="font-mono text-[10px] tracking-[0.14em] text-bear uppercase">
              看空理由
            </span>
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {(verdict.bearish.length > 0 ? verdict.bearish : ['暂无明确的风险论据。']).map(
              (item, index) => (
                <li key={index} className="flex gap-1.5 text-[11.5px] leading-relaxed text-dim">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-bear" />
                  <span>{item}</span>
                </li>
              ),
            )}
          </ul>
        </div>
      </div>

      {(verdict.catalyst || verdict.risks) && (
        <div className="relative mt-3 grid gap-3 sm:grid-cols-2">
          {verdict.catalyst && (
            <div>
              <div className="font-mono text-[10px] tracking-[0.14em] text-gold/80 uppercase">
                关键催化剂
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-dim">{verdict.catalyst}</p>
            </div>
          )}
          {verdict.risks && (
            <div>
              <div className="font-mono text-[10px] tracking-[0.14em] text-bear/80 uppercase">
                主要风险
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-dim">{verdict.risks}</p>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="relative mt-3 flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/[0.07] px-3 py-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-gold" />
          <p className="text-[11px] leading-relaxed text-dim">
            <span className="text-gold">AI 诊断失败：</span>
            {error}
            <span className="text-faint"> 已回退至本地量化引擎结论。</span>
          </p>
        </div>
      )}

      <div className="relative mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3">
        <span className="font-mono text-[10px] text-faint">
          {security.symbol} · 综合评分 {verdict.score}/100 · 生成于 {formatDateTime(verdict.generatedAt)}
        </span>
        {hasGemini ? (
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] font-medium transition',
              running
                ? 'border-line-2 bg-panel-2 text-dim'
                : 'border-gold/50 bg-gold/15 text-gold hover:bg-gold/25',
            )}
          >
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {running ? '深度诊断中…' : '运行深度 AI 诊断'}
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gold/40 bg-gold/10 px-3 py-1.5 font-mono text-[11px] text-gold transition hover:bg-gold/20"
          >
            <Lock className="size-3.5" />
            配置 Gemini Key 解锁深度诊断
          </button>
        )}
      </div>
    </div>
  )
}
