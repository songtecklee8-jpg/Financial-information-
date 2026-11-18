import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, Search } from 'lucide-react'

import type { Security } from '@/types'
import { cn } from '@/lib/cn'
import { normalizeSymbol, searchSecurities } from '@/lib/universe'

interface SearchBarProps {
  onSelect: (symbol: string) => void
  /** 当前选中标的，用于在结果中打勾 */
  activeSymbol?: string
  className?: string
  placeholder?: string
  /** 是否绑定全局 "/" 与 ⌘K 快捷键 */
  bindGlobalShortcut?: boolean
}

type Option =
  | { kind: 'security'; security: Security }
  | { kind: 'direct'; symbol: string }

function MarketChip({ market }: { market: Security['market'] }) {
  return market === 'BURSA' ? (
    <span className="rounded border border-ice/30 bg-ice/10 px-1.5 py-[1px] font-mono text-[9px] text-ice">
      BURSA
    </span>
  ) : (
    <span className="rounded border border-gold/30 bg-gold/10 px-1.5 py-[1px] font-mono text-[9px] text-gold">
      US
    </span>
  )
}

export function SearchBar({
  onSelect,
  activeSymbol,
  className,
  placeholder = '搜索美股 / 马股代码或名称 — 例：AAPL、NVDA、1155.KL、Maybank',
  bindGlobalShortcut = true,
}: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const options = useMemo<Option[]>(() => {
    const matches = searchSecurities(query, 7)
    const normalized = normalizeSymbol(query)
    const looksLikeTicker = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(normalized)
    const alreadyMatched = matches.some((security) => security.symbol === normalized)
    const list: Option[] = matches.map((security) => ({ kind: 'security', security }))
    if (looksLikeTicker && !alreadyMatched) {
      list.push({ kind: 'direct', symbol: normalized })
    }
    return list
  }, [query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!bindGlobalShortcut) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !isTyping)) {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [bindGlobalShortcut])

  const commit = (option: Option) => {
    const symbol = option.kind === 'security' ? option.security.symbol : option.symbol
    onSelect(symbol)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => Math.min(index + 1, Math.max(options.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = options[activeIndex]
      if (option) commit(option)
      else if (query.trim()) onSelect(normalizeSymbol(query))
    } else if (event.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const showPanel = open && options.length > 0

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" />
      <input
        ref={inputRef}
        value={query}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="全局证券搜索"
        className="w-full rounded-lg border border-line bg-void/70 py-2 pr-14 pl-9 text-[13px] text-ink transition placeholder:text-faint/80 focus:border-gold/55 focus:bg-void"
      />
      <div className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2">
        <kbd className="rounded border border-line bg-panel-2 px-1.5 py-[2px] font-mono text-[10px] text-faint">
          ⌘K
        </kbd>
      </div>

      {showPanel && (
        <div className="rise-in absolute top-[calc(100%+6px)] z-40 w-full overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/70">
          <div className="max-h-[340px] overflow-y-auto py-1">
            {options.map((option, index) => {
              const isActive = index === activeIndex
              if (option.kind === 'direct') {
                return (
                  <button
                    key={`direct-${option.symbol}`}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(option)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors',
                      isActive ? 'bg-gold/10' : 'hover:bg-panel-2',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <CornerDownLeft className="size-3 shrink-0 text-gold" />
                      <span className="font-mono text-[12.5px] font-medium text-gold">
                        直接查询 {option.symbol}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-faint">
                      {option.symbol.endsWith('.KL') ? 'BURSA · MYR' : 'US · USD'}
                    </span>
                  </button>
                )
              }
              const { security } = option
              const isCurrent = security.symbol === activeSymbol
              return (
                <button
                  key={security.symbol}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(option)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors',
                    isActive ? 'bg-panel-3' : 'hover:bg-panel-2',
                  )}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-[12.5px] font-semibold text-ink">
                        {security.symbol}
                      </span>
                      <MarketChip market={security.market} />
                      {isCurrent && (
                        <span className="font-mono text-[9px] text-gold">● 当前</span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-dim">{security.name}</span>
                  </span>
                  <span className="hidden shrink-0 text-right sm:block">
                    <span className="block font-mono text-[10px] text-faint">{security.exchange}</span>
                    <span className="block text-[10px] text-faint/80">{security.sector}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center justify-between border-t border-line bg-void/50 px-3 py-1.5 font-mono text-[10px] text-faint">
            <span>支持美股与 Bursa 马股（严格 .KL 后缀）</span>
            <span className="flex items-center gap-2">
              <span>↑↓ 选择</span>
              <span className="inline-flex items-center gap-1">
                <CornerDownLeft className="size-2.5" />
                确认
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
