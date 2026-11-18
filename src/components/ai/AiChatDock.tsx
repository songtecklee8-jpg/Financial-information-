import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Loader2, Lock, Send, Sparkles, Trash2, X } from 'lucide-react'

import type { ChatMessage, Security, ValuationResult } from '@/types'
import { cn } from '@/lib/cn'
import { formatPercent } from '@/lib/format'
import { localChatFallback, modelDisplayName, runChat, type AiRoute } from '@/lib/gemini'
import type { AiContextInput } from '@/lib/aiContext'

interface AiChatDockProps {
  security: Security
  valuation: ValuationResult
  aiInput: AiContextInput
  hasGemini: boolean
  apiKey: string
  route: AiRoute
  onOpenSettings: () => void
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const SUGGESTIONS = [
  '用三点总结该标的当前的投资逻辑',
  '当前安全边际是否足够？请给出重估后的合理区间',
  '重新调整评分权重：更看重股息率与安全边际',
  '结合美债收益率与 OPR 谈谈贴现率对该股的影响',
]

/** 右下角悬浮的 AI 金融研究助理 */
export function AiChatDock({
  security,
  valuation,
  aiInput,
  hasGemini,
  apiKey,
  route,
  onOpenSettings,
}: AiChatDockProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [usedModel, setUsedModel] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 切换标的时重置会话，保证上下文与当前标的对应
  useEffect(() => {
    abortRef.current?.abort()
    setMessages([])
    setDraft('')
    setSending(false)
  }, [security.symbol])

  useEffect(() => {
    if (!open) return
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, open, sending])

  useEffect(() => () => abortRef.current?.abort(), [])

  const greeting = useMemo(
    () =>
      `已载入 ${security.symbol}（${security.name}）的终端快照：综合评分 ${valuation.score}/100，安全边际 ${formatPercent(
        valuation.marginOfSafetyPct,
        { signed: true },
      )}。你可以针对该标的的财务指标、估值假设或宏观利率提问。`,
    [security.symbol, security.name, valuation.score, valuation.marginOfSafetyPct],
  )

  const send = async (text: string) => {
    const content = text.trim()
    if (!content || sending) return
    const userMessage: ChatMessage = {
      id: makeId(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    }
    const history = [...messages, userMessage]
    setMessages(history)
    setDraft('')
    setSending(true)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      if (!hasGemini) {
        await new Promise((resolve) => setTimeout(resolve, 350))
        setMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            role: 'assistant',
            content: localChatFallback(),
            createdAt: new Date().toISOString(),
            degraded: true,
          },
        ])
      } else {
        const reply = await runChat(history, aiInput, apiKey, route, controller.signal)
        setUsedModel(reply.model)
        setMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            role: 'assistant',
            content: reply.text,
            createdAt: new Date().toISOString(),
          },
        ])
      }
    } catch (cause) {
      if (controller.signal.aborted) return
      const message = cause instanceof Error ? cause.message : '未知错误'
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          content: `请求失败：${message}`,
          createdAt: new Date().toISOString(),
          degraded: true,
        },
      ])
    } finally {
      if (!controller.signal.aborted) setSending(false)
    }
  }

  return (
    <>
      {/* 收起态：悬浮启动按钮 */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="glow-gold fixed right-4 bottom-4 z-40 inline-flex items-center gap-2 rounded-full border border-gold/50 bg-panel px-4 py-3 font-mono text-[12px] font-medium text-gold shadow-2xl shadow-black/60 transition hover:bg-gold/15 sm:right-5 sm:bottom-5"
          title="打开 AI 金融研究助理"
        >
          <Sparkles className="size-4" />
          <span className="hidden sm:inline">AI 研究助理</span>
          {!hasGemini && <Lock className="size-3 text-faint" />}
        </button>
      )}

      {/* 展开态：悬浮聊天面板 */}
      {open && (
        <div
          className={cn(
            'rise-in fixed z-40 flex flex-col overflow-hidden border border-line bg-panel shadow-2xl shadow-black/70',
            'inset-x-3 bottom-3 h-[min(620px,80vh)] rounded-2xl',
            'sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[400px]',
          )}
        >
          <header className="flex items-center justify-between gap-2 border-b border-line bg-void/50 px-3.5 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg border border-gold/40 bg-gold/10">
                <Bot className="size-3.5 text-gold" />
              </div>
              <div className="min-w-0">
                <div className="font-mono text-[12px] font-semibold text-ink">AI 金融研究助理</div>
                <div className="truncate font-mono text-[9.5px] text-faint">
                  {security.symbol} ·{' '}
                  {hasGemini
                    ? usedModel
                      ? `Powered by ${modelDisplayName(usedModel)}`
                      : 'Gemini 三级路由'
                    : '本地模式'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMessages([])}
                  title="清空对话"
                  className="rounded-md border border-line p-1.5 text-faint transition hover:border-line-2 hover:text-ink"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="收起"
                className="rounded-md border border-line p-1.5 text-faint transition hover:border-line-2 hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </header>

          <div ref={listRef} className="scroll-fade flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
            <div className="flex gap-2">
              <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-line-2 bg-void/60">
                <Bot className="size-3 text-dim" />
              </div>
              <p className="rounded-lg rounded-tl-none border border-line bg-panel-2 px-3 py-2 text-[11.5px] leading-relaxed text-dim">
                {greeting}
              </p>
            </div>

            {messages.map((message) =>
              message.role === 'user' ? (
                <div key={message.id} className="flex justify-end gap-2">
                  <p className="max-w-[85%] rounded-lg rounded-tr-none border border-gold/30 bg-gold/10 px-3 py-2 text-[11.5px] leading-relaxed text-ink">
                    {message.content}
                  </p>
                </div>
              ) : (
                <div key={message.id} className="flex gap-2">
                  <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-line-2 bg-void/60">
                    <Bot className="size-3 text-dim" />
                  </div>
                  <div className="max-w-[88%]">
                    <p className="rounded-lg rounded-tl-none border border-line bg-panel-2 px-3 py-2 text-[11.5px] leading-relaxed whitespace-pre-wrap text-dim">
                      {message.content}
                    </p>
                    {message.degraded && (
                      <span className="mt-1 inline-block font-mono text-[9.5px] text-gold/80">本地降级回复</span>
                    )}
                  </div>
                </div>
              ),
            )}

            {sending && (
              <div className="flex items-center gap-2 px-1 font-mono text-[10.5px] text-faint">
                <Loader2 className="size-3 animate-spin text-gold" />
                正在生成研报…
              </div>
            )}

            {messages.length === 0 && !sending && (
              <div className="space-y-1.5 pt-1">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => send(suggestion)}
                    className="block w-full rounded-lg border border-line bg-void/40 px-3 py-2 text-left text-[11px] text-dim transition hover:border-gold/40 hover:text-gold"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!hasGemini && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 border-t border-line bg-gold/[0.06] px-3.5 py-2 text-left font-mono text-[10.5px] text-gold transition hover:bg-gold/12"
            >
              <Lock className="size-3" />
              未配置 Gemini Key，当前为本地模式 · 点击前往配置
            </button>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault()
              void send(draft)
            }}
            className="flex items-end gap-2 border-t border-line bg-void/40 px-3 py-2.5"
          >
            <textarea
              value={draft}
              rows={1}
              placeholder="针对当前标的提问，或要求调整计算权重…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send(draft)
                }
              }}
              className="max-h-28 min-h-[38px] flex-1 resize-none rounded-lg border border-line bg-void/70 px-3 py-2 text-[12px] text-ink transition placeholder:text-faint/80 focus:border-gold/55"
            />
            <button
              type="submit"
              disabled={sending || draft.trim().length === 0}
              className={cn(
                'inline-flex size-[38px] shrink-0 items-center justify-center rounded-lg border transition',
                sending || draft.trim().length === 0
                  ? 'border-line bg-panel-2 text-faint'
                  : 'border-gold/50 bg-gold/15 text-gold hover:bg-gold/25',
              )}
              title="发送"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </form>
        </div>
      )}
    </>
  )
}
