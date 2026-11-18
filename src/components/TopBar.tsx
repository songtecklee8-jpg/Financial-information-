import { Activity, KeyRound, Radio } from 'lucide-react'

import { Badge } from '@/components/ui/Badge'
import { SearchBar } from '@/components/SearchBar'
import { useClock } from '@/hooks/useClock'
import { cn } from '@/lib/cn'
import { formatClock } from '@/lib/format'

interface TopBarProps {
  symbol: string
  onSelect: (symbol: string) => void
  onOpenSettings: () => void
  origin: 'live' | 'baseline'
  hasTwelveData: boolean
  hasGemini: boolean
}

function MarketClock() {
  const now = useClock()
  const kl = formatClock(now, 'Asia/Kuala_Lumpur')
  const ny = formatClock(now, 'America/New_York')
  return (
    <div className="hidden items-center gap-3 font-mono text-[10.5px] lg:flex">
      <div className="flex items-center gap-1.5">
        <span className="text-faint">KL</span>
        <span className="text-ink">{kl}</span>
      </div>
      <span className="h-3 w-px bg-line-2" />
      <div className="flex items-center gap-1.5">
        <span className="text-faint">NY</span>
        <span className="text-ink">{ny}</span>
      </div>
    </div>
  )
}

export function TopBar({
  symbol,
  onSelect,
  onOpenSettings,
  origin,
  hasTwelveData,
  hasGemini,
}: TopBarProps) {
  const now = useClock(30_000)
  const klDate = now.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'Asia/Kuala_Lumpur',
  })

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-abyss/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4 lg:py-2">
        {/* 品牌 */}
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="relative flex size-8 items-center justify-center rounded-md border border-gold/40 bg-gold/10">
            <Activity className="size-4 text-gold text-glow-gold" />
            <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-bull live-dot" />
          </div>
          <div className="leading-none">
            <div className="font-mono text-[15px] font-bold tracking-[0.14em] text-gold text-glow-gold">
              APEX
              <span className="text-ink"> TERMINAL</span>
            </div>
            <div className="mt-1 font-mono text-[9px] tracking-[0.16em] text-faint uppercase">
              Global &amp; Bursa Market Intelligence
            </div>
          </div>
        </div>

        {/* 搜索 */}
        <div className="order-last w-full min-w-0 lg:order-none lg:mx-2 lg:w-auto lg:max-w-2xl lg:flex-1">
          <SearchBar onSelect={onSelect} activeSymbol={symbol} />
        </div>

        {/* 右侧状态区 */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-1.5 xl:flex">
            <span className="font-mono text-[10.5px] text-faint">{klDate}</span>
          </div>
          <MarketClock />

          <div className="hidden items-center gap-1.5 sm:flex">
            {origin === 'live' ? (
              <Badge tone="bull" dot title="行情来自 Twelve Data 实时接口">
                Live Feed
              </Badge>
            ) : (
              <Badge tone="neutral" dot title="未配置 API Key，当前为终端内置基准数据">
                Baseline
              </Badge>
            )}
          </div>

          <button
            type="button"
            onClick={onOpenSettings}
            className={cn(
              'group inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] transition',
              hasTwelveData || hasGemini
                ? 'border-line-2 bg-panel-2 text-dim hover:border-gold/50 hover:text-gold'
                : 'border-gold/45 bg-gold/10 text-gold hover:bg-gold/15',
            )}
            title="配置 Twelve Data 与 Gemini API Key"
          >
            {hasGemini ? <Radio className="size-3.5" /> : <KeyRound className="size-3.5" />}
            <span className="hidden sm:inline">API 设置</span>
            <span className="sm:hidden">API</span>
            {!hasTwelveData && !hasGemini && (
              <span className="ml-0.5 hidden rounded bg-gold/20 px-1 py-[1px] text-[9px] sm:inline">
                待配置
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  )
}
