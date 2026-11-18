import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CircleCheck,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'

import type { PaperProfile, ProfileStats, TradeReview } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { MeterBar } from '@/components/ui/MeterBar'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { modelDisplayName, runTradeReview, type AiRoute } from '@/lib/gemini'

interface TradeReviewPanelProps {
  profile: PaperProfile
  stats: ProfileStats
  hasGemini: boolean
  apiKey: string
  route: AiRoute
  onOpenSettings: () => void
}

export function TradeReviewPanel({
  profile,
  stats,
  hasGemini,
  apiKey,
  route,
  onOpenSettings,
}: TradeReviewPanelProps) {
  const [review, setReview] = useState<TradeReview | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 切换账户时清空上一次复盘
  useEffect(() => {
    abortRef.current?.abort()
    setReview(null)
    setError(null)
    setRunning(false)
  }, [profile.id])

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setError(null)
    runTradeReview(profile, stats, apiKey, route, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setReview(result)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : 'AI 复盘失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setRunning(false)
      })
  }, [profile, stats, apiKey, route])

  return (
    <section className="panel hairline-top flex min-w-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="font-mono text-[10px] tracking-[0.18em] text-gold/80 uppercase">AI Trade Review</div>
          <h2 className="text-[13px] font-semibold tracking-wide text-ink">AI 交易表现深度诊断</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {!hasGemini && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1 rounded-lg border border-gold/45 bg-gold/10 px-2.5 py-1.5 font-mono text-[10.5px] text-gold transition hover:bg-gold/20"
              title="配置 Gemini Key 可获得结合宏观利率与历史周期的深度诊断"
            >
              <KeyRound className="size-3" /> 配置 Gemini
            </button>
          )}
          <button
            type="button"
            disabled={running}
            onClick={run}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] transition',
              running
                ? 'cursor-not-allowed border-line bg-panel-2 text-faint'
                : 'border-gold/50 bg-gold/15 text-gold hover:bg-gold/25',
            )}
          >
            {running ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {review ? '重新诊断' : '生成深度诊断'}
          </button>
        </div>
      </header>

      <div className="p-3.5">
        {!review && !running && !error && (
          <p className="text-[11.5px] leading-relaxed text-dim">
            一键读取当前账户的完整交易流水、持仓集中度、盈亏比与实时市场环境，输出
            <span className="text-gold">「做得好的地方」</span>与
            <span className="text-gold">「需要改善的地方」</span>
            两大板块，并给出可落地的仓位调整与风控方案。
            {!hasGemini && ' 未配置 Gemini Key 时将使用本地量化启发式引擎生成复盘。'}
          </p>
        )}

        {running && (
          <div className="flex items-center gap-2 py-6 font-mono text-[11.5px] text-gold">
            <LoaderCircle className="size-4 animate-spin" /> Gemini 正在结合金融理论与历史周期复盘该账户…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1.5 rounded-lg border border-bear/35 bg-bear/10 px-2.5 py-2 font-mono text-[11px] text-bear">
            <TriangleAlert className="mt-[1px] size-3.5 shrink-0" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {review && !running && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12.5px] leading-snug font-medium text-ink">{review.headline}</p>
              {review.degraded ? (
                <Badge tone="neutral" title="未配置 Gemini Key，由本地量化引擎生成">LOCAL ENGINE</Badge>
              ) : (
                <Badge tone="iris" title={`实际执行模型：${review.model}`}>
                  Powered by {modelDisplayName(review.model)}
                </Badge>
              )}
            </div>

            <div className="rounded-lg border border-line bg-void/40 px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between font-mono text-[11px]">
                <span className="text-faint">交易纪律评分</span>
                <span className="text-gold">{review.disciplineScore} / 100</span>
              </div>
              <MeterBar value={review.disciplineScore} tone="gold" height={5} />
            </div>

            <div className="rounded-lg border border-bull/25 bg-bull/[0.05] p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <CircleCheck className="size-3.5 text-bull" />
                <span className="font-mono text-[11px] tracking-[0.1em] text-bull uppercase">做得好的地方</span>
              </div>
              <ul className="space-y-1.5">
                {review.strengths.map((item, index) => (
                  <li key={index} className="flex gap-1.5 text-[11.5px] leading-relaxed text-dim">
                    <span className="mt-[6px] size-1 shrink-0 rounded-full bg-bull" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-bear/25 bg-bear/[0.05] p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <TriangleAlert className="size-3.5 text-bear" />
                <span className="font-mono text-[11px] tracking-[0.1em] text-bear uppercase">需要改善的地方</span>
              </div>
              <ul className="space-y-1.5">
                {review.improvements.map((item, index) => (
                  <li key={index} className="flex gap-1.5 text-[11.5px] leading-relaxed text-dim">
                    <span className="mt-[6px] size-1 shrink-0 rounded-full bg-bear" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-ice/25 bg-ice/[0.05] p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-ice" />
                <span className="font-mono text-[11px] tracking-[0.1em] text-ice uppercase">仓位与风控方案</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-dim">{review.riskPlan}</p>
            </div>

            <p className="text-right font-mono text-[10px] text-faint">
              生成于 {formatDateTime(review.generatedAt)}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
