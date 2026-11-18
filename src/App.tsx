import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid } from 'lucide-react'

import type { AiVerdict } from '@/types'
import { AiChatDock } from '@/components/ai/AiChatDock'
import { ApiSettingsModal } from '@/components/ApiSettingsModal'
import { MacroPanel } from '@/components/macro/MacroPanel'
import { NewsFeed } from '@/components/news/NewsFeed'
import { QuoteHero } from '@/components/market/QuoteHero'
import { TickerTape } from '@/components/market/TickerTape'
import { TopBar } from '@/components/TopBar'
import { ValuationPanel } from '@/components/valuation/ValuationPanel'
import { WatchGrid } from '@/components/market/WatchGrid'
import { useApiSettings } from '@/hooks/useApiSettings'
import { useMacro } from '@/hooks/useMacro'
import { useNews } from '@/hooks/useNews'
import { useSecuritySnapshot } from '@/hooks/useSecuritySnapshot'
import type { AiContextInput } from '@/lib/aiContext'
import { runVerdictReport } from '@/lib/gemini'
import { computeValuation } from '@/lib/valuation'

const DEFAULT_SYMBOL = 'AAPL'

export default function App() {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const api = useApiSettings()
  const snapshot = useSecuritySnapshot(symbol, api.settings.twelveDataKey)
  const { macro, refresh: refreshMacro } = useMacro()
  const { items: news, status: newsStatus } = useNews()

  const [aiVerdict, setAiVerdict] = useState<AiVerdict | null>(null)
  const [aiRunning, setAiRunning] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const aiAbortRef = useRef<AbortController | null>(null)

  const valuation = useMemo(
    () =>
      computeValuation({
        security: snapshot.security,
        fundamentals: snapshot.fundamentals,
        price: snapshot.quote.price,
        currency: snapshot.quote.currency,
        macro,
      }),
    [snapshot.security, snapshot.fundamentals, snapshot.quote.price, snapshot.quote.currency, macro],
  )

  const aiInput = useMemo<AiContextInput>(
    () => ({
      security: snapshot.security,
      quote: snapshot.quote,
      fundamentals: snapshot.fundamentals,
      valuation,
      macro,
      news,
    }),
    [snapshot.security, snapshot.quote, snapshot.fundamentals, valuation, macro, news],
  )

  // 切换标的时清除上一只股票的 AI 结论
  useEffect(() => {
    aiAbortRef.current?.abort()
    setAiVerdict(null)
    setAiError(null)
    setAiRunning(false)
  }, [symbol])

  useEffect(() => () => aiAbortRef.current?.abort(), [])

  const runAiDiagnosis = useCallback(() => {
    if (!api.hasGemini || aiRunning) {
      if (!api.hasGemini) setSettingsOpen(true)
      return
    }
    aiAbortRef.current?.abort()
    const controller = new AbortController()
    aiAbortRef.current = controller
    setAiRunning(true)
    setAiError(null)
    runVerdictReport(aiInput, api.settings.geminiKey, api.settings.geminiModel, controller.signal)
      .then((verdict) => {
        if (controller.signal.aborted) return
        setAiVerdict(verdict)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setAiError(cause instanceof Error ? cause.message : 'AI 诊断失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setAiRunning(false)
      })
  }, [api.hasGemini, api.settings.geminiKey, api.settings.geminiModel, aiInput, aiRunning])

  // 配置 Gemini Key 后自动运行一次深度诊断
  const autoRunRef = useRef<string | null>(null)
  useEffect(() => {
    if (!api.hasGemini) return
    const token = `${symbol}:${api.settings.geminiModel}`
    if (autoRunRef.current === token) return
    autoRunRef.current = token
    runAiDiagnosis()
    // runAiDiagnosis 依赖 aiInput，切换标的后由下方 effect 触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.hasGemini, symbol, api.settings.geminiModel])

  return (
    <div className="relative flex min-h-full flex-col">
      <div className="term-backdrop" aria-hidden />

      <div className="relative z-10 flex min-h-full flex-1 flex-col">
        <TopBar
          symbol={symbol}
          onSelect={setSymbol}
          onOpenSettings={() => setSettingsOpen(true)}
          origin={snapshot.origin}
          hasTwelveData={api.hasTwelveData}
          hasGemini={api.hasGemini}
        />
        <TickerTape onSelect={setSymbol} />

        <main className="mx-auto w-full max-w-[1800px] flex-1 px-3 pt-3 pb-24 sm:px-4">
          <section className="mb-3">
            <div className="mb-2 flex items-center gap-2">
              <LayoutGrid className="size-3.5 text-gold/80" />
              <h2 className="font-mono text-[11px] font-medium tracking-[0.16em] text-dim uppercase">
                热门标的行情墙
              </h2>
              <span className="font-mono text-[10px] text-faint">点击任意卡片切换诊断标的</span>
            </div>
            <WatchGrid
              activeSymbol={symbol}
              onSelect={setSymbol}
              liveQuote={snapshot.quote}
              liveOrigin={snapshot.origin}
            />
          </section>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
            <div className="min-w-0 space-y-3 xl:col-span-8">
              <QuoteHero
                security={snapshot.security}
                quote={snapshot.quote}
                origin={snapshot.origin}
                loading={snapshot.loading}
                error={snapshot.error}
                endpoints={snapshot.endpoints}
                onRefresh={snapshot.refresh}
              />
              <ValuationPanel
                security={snapshot.security}
                fundamentals={snapshot.fundamentals}
                valuation={valuation}
                aiVerdict={aiVerdict}
                aiRunning={aiRunning}
                aiError={aiError}
                hasGemini={api.hasGemini}
                onRunAi={runAiDiagnosis}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            </div>

            <aside className="min-w-0 space-y-3 xl:col-span-4">
              <MacroPanel macro={macro} onRefresh={refreshMacro} />
              <NewsFeed items={news} status={newsStatus} activeSymbol={symbol} />
            </aside>
          </div>

          <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3 font-mono text-[10px] text-faint">
            <span>
              APEX TERMINAL · 全球 &amp; 大马金融市场终端 · 数据源 Twelve Data / BNM / 公开 RSS
            </span>
            <span>
              本终端所有评分、内在价值与裁决仅用于量化研究与演示，不构成任何投资建议。
            </span>
          </footer>
        </main>
      </div>

      <AiChatDock
        security={snapshot.security}
        valuation={valuation}
        aiInput={aiInput}
        hasGemini={api.hasGemini}
        apiKey={api.settings.geminiKey}
        model={api.settings.geminiModel}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <ApiSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={api.settings}
        onSave={api.save}
        onReset={api.reset}
      />
    </div>
  )
}
