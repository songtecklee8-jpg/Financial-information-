import {
  Activity,
  Brain,
  GraduationCap,
  KeyRound,
  Newspaper,
  Radio,
} from 'lucide-react'

import { useClock } from '@/hooks/useClock'
import { cn } from '@/lib/cn'
import { formatClock } from '@/lib/format'

/** 顶部导航三大独立工作区 */
export type AppView = 'news' | 'analysis' | 'cfa'

const NAV_ITEMS: Array<{ key: AppView; label: string; hint: string; icon: typeof Newspaper }> = [
  { key: 'news', label: '新闻情报与 AI 摘要', hint: '多源财经新闻聚合 · 公司关键词检索 · 一键 AI 摘要与多空情绪判断', icon: Newspaper },
  { key: 'analysis', label: '财报长文深度分析', hint: '粘贴财报纪要与研报长文 · 四维结构化投研报告', icon: Brain },
  { key: 'cfa', label: 'CFA L1 2027 备考工作台', hint: '2027 Handbook 导入 · 跟课精讲 · 过关测验 · 无限刷题 · 错题本', icon: GraduationCap },
]

interface TopBarProps {
  onOpenSettings: () => void
  view: AppView
  onNavigate: (view: AppView) => void
  hasGemini: boolean
  geminiCount: number
  backupAiCount: number
}

function MarketClock() {
  const now = useClock()
  const kl = formatClock(now, 'Asia/Kuala_Lumpur')
  const ny = formatClock(now, 'America/New_York')
  return (
    <div className="hidden items-center gap-3 font-mono text-[10.5px] xl:flex">
      <div className="flex items-center gap-1.5">
        <span className="text-faint">KL</span>
        <span className="tabular-nums text-ink">{kl}</span>
      </div>
      <span className="h-3 w-px bg-line-2" />
      <div className="flex items-center gap-1.5">
        <span className="text-faint">NY</span>
        <span className="tabular-nums text-ink">{ny}</span>
      </div>
    </div>
  )
}

export function TopBar({
  onOpenSettings,
  view,
  onNavigate,
  hasGemini,
  geminiCount,
  backupAiCount,
}: TopBarProps) {
  const now = useClock(30_000)
  const klDate = now.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'Asia/Kuala_Lumpur',
  })

  const totalBatons = (hasGemini ? 1 : 0) + backupAiCount

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-abyss/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4 lg:py-2">
        {/* 品牌 */}
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md border border-gold/40 bg-gold/10">
            <Activity className="size-4 text-gold" />
          </div>
          <div className="leading-none">
            <div className="font-mono text-[15px] font-bold tracking-[0.14em] text-gold">
              APEX
              <span className="text-ink"> RESEARCH</span>
            </div>
            <div className="mt-1 font-mono text-[9px] tracking-[0.14em] text-faint uppercase">
              AI 投研与 CFA L1 2027 备考工作台
            </div>
          </div>
        </div>

        {/* 主导航：三大独立工作台 */}
        <nav className="no-scrollbar flex max-w-full items-center gap-1.5 overflow-x-auto">
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
                  'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[12px] font-medium whitespace-nowrap transition',
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

        {/* 右侧状态指示灯与接力赛配置入口 */}
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="hidden items-center gap-1.5 2xl:flex">
            <span className="font-mono text-[10.5px] text-faint">{klDate}</span>
          </div>
          <MarketClock />

          <div
            className="inline-flex items-center gap-1.5 font-mono text-[10.5px]"
            title={
              hasGemini
                ? `第 1 棒 Gemini 主力就绪（${geminiCount} 把密钥），共 ${totalBatons} 棒接力通道可用`
                : backupAiCount > 0
                  ? `第 1 棒未配置，备用接力通道就绪 ${backupAiCount} 棒`
                  : '等待配置 AI 接力通道'
            }
          >
            <span
              className={cn(
                'size-2 rounded-full',
                hasGemini ? 'bg-bull' : backupAiCount > 0 ? 'bg-gold' : 'bg-bear/70',
              )}
            />
            <span className="text-dim">
              {hasGemini
                ? `Gemini 领跑 · ${totalBatons} 棒就绪`
                : backupAiCount > 0
                  ? `备用接力 · ${backupAiCount} 棒就绪`
                  : '待配置接力密钥'}
            </span>
          </div>

          <button
            type="button"
            onClick={onOpenSettings}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] transition',
              totalBatons > 0
                ? 'border-line-2 bg-panel-2 text-dim hover:border-gold/50 hover:text-gold'
                : 'border-gold/45 bg-gold/10 text-gold hover:bg-gold/15',
            )}
            title="打开 10 棒 AI 接力赛与新闻 API 配置"
          >
            {hasGemini ? <Radio className="size-3.5" /> : <KeyRound className="size-3.5" />}
            <span>API 接力赛配置</span>
          </button>
        </div>
      </div>
    </header>
  )
}
