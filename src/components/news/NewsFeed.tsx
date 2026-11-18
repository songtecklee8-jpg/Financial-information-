import { useMemo, useState } from 'react'
import { ExternalLink, Newspaper } from 'lucide-react'

import type { NewsItem, NewsSource } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { Panel } from '@/components/ui/Panel'
import { cn } from '@/lib/cn'
import { formatRelativeTime } from '@/lib/format'
import { NEWS_SOURCES } from '@/lib/news'

interface NewsFeedProps {
  items: NewsItem[]
  status: 'baseline' | 'loading' | 'live'
  activeSymbol?: string
  className?: string
}

type Filter = 'ALL' | NewsSource

const SENTIMENT_META: Record<NewsItem['sentiment'], { dot: string; label: string }> = {
  bullish: { dot: 'bg-bull', label: '偏多' },
  bearish: { dot: 'bg-bear', label: '偏空' },
  neutral: { dot: 'bg-dim', label: '中性' },
}

const SOURCE_TONE: Record<NewsSource, 'gold' | 'ice' | 'iris'> = {
  WSJ: 'gold',
  华尔街见闻: 'iris',
  'The Star Business': 'ice',
}

export function NewsFeed({ items, status, activeSymbol, className }: NewsFeedProps) {
  const [filter, setFilter] = useState<Filter>('ALL')

  const filtered = useMemo(() => {
    const base = filter === 'ALL' ? items : items.filter((item) => item.source === filter)
    if (!activeSymbol) return base
    const code = activeSymbol.replace(/\.KL$/, '')
    return [...base].sort((a, b) => {
      const score = (item: NewsItem) =>
        item.tickers.some((t) => t === activeSymbol || t.replace(/\.KL$/, '') === code) ? 1 : 0
      return score(b) - score(a)
    })
  }, [items, filter, activeSymbol])

  const tabs: Filter[] = ['ALL', ...NEWS_SOURCES]

  return (
    <Panel
      eyebrow="Newsroom"
      title="多源财经新闻"
      subtitle="WSJ · 华尔街见闻 · The Star Business"
      className={className}
      bodyClassName="flex min-h-0 flex-col p-0!"
      actions={
        status === 'live' ? (
          <Badge tone="bull" dot>
            LIVE FEED
          </Badge>
        ) : status === 'loading' ? (
          <Badge tone="neutral" dot>
            加载中
          </Badge>
        ) : (
          <Badge tone="neutral" title="RSS 源不可达，已回退至基准新闻流">
            BASELINE
          </Badge>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line/70 px-3 py-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilter(tab)}
            className={cn(
              'rounded-full border px-2.5 py-1 font-mono text-[10.5px] transition',
              filter === tab
                ? 'border-gold/50 bg-gold/12 text-gold'
                : 'border-line bg-panel-2 text-dim hover:border-line-2 hover:text-ink',
            )}
          >
            {tab === 'ALL' ? '全部' : tab}
          </button>
        ))}
      </div>

      <div className="scroll-fade max-h-[520px] min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Newspaper className="size-6 text-faint" />
            <p className="text-[11.5px] text-faint">该来源暂无新闻</p>
          </div>
        ) : (
          <ul className="divide-y divide-line/60">
            {filtered.map((item) => {
              const sentiment = SENTIMENT_META[item.sentiment]
              const isRelated =
                activeSymbol !== undefined &&
                item.tickers.some(
                  (t) => t === activeSymbol || t.replace(/\.KL$/, '') === activeSymbol.replace(/\.KL$/, ''),
                )
              return (
                <li key={item.id}>
                  <a
                    href={item.url && item.url !== '#' ? item.url : undefined}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={cn(
                      'group block px-3 py-2.5 transition-colors',
                      isRelated ? 'bg-gold/[0.05] hover:bg-gold/[0.09]' : 'hover:bg-panel-2',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={cn('size-1.5 shrink-0 rounded-full', sentiment.dot)} title={sentiment.label} />
                        <Badge tone={SOURCE_TONE[item.source]}>{item.source}</Badge>
                        {isRelated && (
                          <span className="font-mono text-[9px] text-gold">● 相关</span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-faint">
                        {formatRelativeTime(item.publishedAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-snug font-medium text-ink transition-colors group-hover:text-gold">
                      {item.title}
                      {item.url && item.url !== '#' && (
                        <ExternalLink className="mb-0.5 ml-1 inline size-2.5 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                    </p>
                    {item.summary && (
                      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-faint">{item.summary}</p>
                    )}
                    {item.tickers.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {item.tickers.slice(0, 4).map((ticker) => (
                          <span
                            key={ticker}
                            className="rounded border border-line bg-void/60 px-1.5 py-[1px] font-mono text-[9.5px] text-dim"
                          >
                            {ticker}
                          </span>
                        ))}
                      </div>
                    )}
                  </a>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Panel>
  )
}
