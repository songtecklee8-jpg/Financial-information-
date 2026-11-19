import {
  Activity,
  Brain,
  KeyRound,
  Newspaper,
  Radio,
} from 'lucide-react'

import { useClock } from '@/hooks/useClock'
import { cn } from '@/lib/cn'
import { formatClock } from '@/lib/format'

/** 顶部导航的两个核心页面：新闻情报 / 财报长文深度分析 */
export type AppView = 'news' | 'analysis'

const NAV_ITEMS: Array<{ key: AppView; label: string; hint: string; icon: typeof Newspaper }> = [
  { key: 'news', label: '新闻情报与 AI 摘要', hint: '多源财经新闻聚合 · 关键字检索 · 一键 AI 摘要与多空情绪判断', icon: Newspaper },
  { key: 'analysis', label: '财报长文与文本深度分析', hint: '粘贴财报纪要与研报长文 · 四维结构化投研报告自动生成', icon: Brain },
]

interface TopBarProps {
  onOpenSettings: () => void
  view: AppView
  onNavigate: (view: AppView) => void
  hasGemini: boolean
  backupAiCount: number
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
  onOpenSettings,
  view,
  onNavigate,
  hasGemini,
  backupAiCount,
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
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4 lg:py-2">
        {/* 品牌 */}
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="relative flex size-8 items-center justify-center rounded-md border border-gold/40 bg-gold/10">
            <Activity className="size-4 text-gold text-glow-gold" />
            <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-bull live-dot" />
          </div>
          <div className="leading-none">
            <div className="font-mono text-[15px] font-bold tracking-[0.14em] text-gold text-glow-gold">
              APEX
              <span className="text-ink"> RESEARCH</span>
            </div>
            <div className="mt-1 font-mono text-[9px] tracking-[0.16em] text-faint uppercase">
              Lightweight AI Investment Research Assistant
            </div>
          </div>
        </div>

        {/* 主导航：两大核心页面分区 */}
        <nav className="flex shrink-0 items-center gap-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = view === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.key)}
                title={item.hint}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[12px] font-medium whitespace-nowrap transition',
                  active
                    ? 'border-gold/50 bg-gold/12 text-gold'
                    : 'border-transparent text-dim hover:border-line-2 hover:text-ink',
                )}
              >
                <Icon className="size-3.5" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* 右侧状态区与模型状态指示灯 */}
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="hidden items-center gap-1.5 xl:flex">
            <span className="font-mono text-[10.5px] text-faint">{klDate}</span>
          </div>
          <MarketClock />

          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2.5 py-1 font-mono text-[10.5px]">
              <span className={cn('size-2 rounded-full', hasGemini || backupAiCount > 0 ? 'bg-bull live-dot' : 'bg-faint')} />
              <span className="text-dim">
                {hasGemini ? 'Gemini 智能引擎' : backupAiCount > 0 ? `备用 AI 就绪 (${backupAiCount})` : 'AI 准备就绪'}
              </span>
            </span>
          </div>

          <button
            type="button"
            onClick={onOpenSettings}
            className={cn(
              'group inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] transition',
              hasGemini || backupAiCount > 0
                ? 'border-line-2 bg-panel-2 text-dim hover:border-gold/50 hover:text-gold'
                : 'border-gold/45 bg-gold/10 text-gold hover:bg-gold/15',
            )}
            title="配置 AI 模型与备用 API Key"
          >
            {hasGemini ? <Radio className="size-3.5" /> : <KeyRound className="size-3.5" />}
            <span className="hidden sm:inline">API 设置</span>
            <span className="sm:hidden">API</span>
          </button>
        </div>
      </div>
    </header>
  )
}
