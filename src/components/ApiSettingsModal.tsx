import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, ExternalLink, LoaderCircle, PlugZap, ShieldCheck } from 'lucide-react'

import type { ApiSettings, ProviderConfig, ProviderHealth, ProviderId } from '@/types'
import { Modal } from '@/components/ui/Modal'
import { DEFAULT_GEMINI_MODEL } from '@/lib/gemini'
import { DEFAULT_API_SETTINGS } from '@/hooks/useApiSettings'
import { useProviderStatuses } from '@/hooks/useProviderStatuses'
import { cn } from '@/lib/cn'
import { testProvider } from '@/lib/market/failover'
import { PROVIDER_IDS, PROVIDER_META, isProviderConfigured } from '@/lib/market/registry'

interface ApiSettingsModalProps {
  open: boolean
  onClose: () => void
  settings: ApiSettings
  onSave: (next: ApiSettings) => void
  onReset: () => void
}

const MODEL_SUGGESTIONS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-flash-latest',
]

const HEALTH_META: Record<ProviderHealth, { dot: string; label: string; tone: string }> = {
  unknown: { dot: 'bg-faint', label: '未测试', tone: 'text-faint' },
  'no-key': { dot: 'bg-faint', label: '未配置', tone: 'text-faint' },
  ready: { dot: 'bg-ice', label: '已就绪', tone: 'text-ice' },
  ok: { dot: 'bg-bull', label: '连通正常', tone: 'text-bull' },
  error: { dot: 'bg-bear', label: '请求失败', tone: 'text-bear' },
  'rate-limited': { dot: 'bg-gold', label: '触发限流', tone: 'text-gold' },
  cooldown: { dot: 'bg-gold', label: '冷却中', tone: 'text-gold' },
  testing: { dot: 'bg-ice', label: '测试中…', tone: 'text-ice' },
}

function displayHealth(configured: boolean, health: ProviderHealth, testing: boolean): ProviderHealth {
  if (testing) return 'testing'
  if (!configured) return 'no-key'
  if (health === 'unknown') return 'ready'
  return health
}

function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  docsUrl,
  docsLabel,
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  docsUrl: string
  docsLabel: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div>
      <label className="font-mono text-[11px] tracking-[0.1em] text-dim uppercase">{label}</label>
      <div className="relative mt-1.5">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-lg border border-line bg-void/70 py-2 pr-10 pl-3 font-mono text-[12px] text-ink transition placeholder:text-faint/70 focus:border-gold/55"
        />
        <button
          type="button"
          onClick={() => setVisible((state) => !state)}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-faint transition hover:text-ink"
          aria-label={visible ? '隐藏密钥' : '显示密钥'}
        >
          {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
        {hint}{' '}
        <a
          href={docsUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-0.5 text-gold/90 underline decoration-gold/30 underline-offset-2 hover:text-gold"
        >
          {docsLabel}
          <ExternalLink className="size-2.5" />
        </a>
      </p>
    </div>
  )
}

function ProviderCard({
  id,
  config,
  status,
  testing,
  onChange,
  onTest,
}: {
  id: ProviderId
  config: ProviderConfig
  status?: ProviderHealth
  testing: boolean
  onChange: (next: ProviderConfig) => void
  onTest: () => void
}) {
  const meta = PROVIDER_META[id]
  const configured = isProviderConfigured(id, config.apiKey, config.secretKey)
  const health = displayHealth(configured, status ?? 'unknown', testing)
  const healthMeta = HEALTH_META[health]

  return (
    <div className="rounded-lg border border-line bg-panel-2/60 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('size-2 shrink-0 rounded-full', healthMeta.dot, health === 'ok' && 'live-dot')} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={cn('font-mono text-[12px] font-semibold', meta.accent)}>{meta.label}</span>
              <span className="truncate font-mono text-[10px] text-faint">{meta.vendor}</span>
            </div>
            <div className={cn('font-mono text-[10px]', healthMeta.tone)}>
              {healthMeta.label}
              {status === 'ok' && configured ? ' · 可参与故障转移' : ''}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line-2 px-2 py-1 font-mono text-[10px] text-dim transition hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed disabled:opacity-40"
        >
          {testing ? <LoaderCircle className="size-3 animate-spin" /> : <PlugZap className="size-3" />}
          测试
        </button>
      </div>

      {(meta.keyLabel || meta.secretLabel) && (
        <div className="mt-2 space-y-2">
          {meta.keyLabel && (
            <div>
              <label className="font-mono text-[10px] tracking-[0.1em] text-faint uppercase">
                {meta.keyLabel}
              </label>
              <input
                type="password"
                value={config.apiKey}
                spellCheck={false}
                autoComplete="off"
                placeholder={meta.requiresKey ? '必填' : '可选'}
                onChange={(event) => onChange({ ...config, apiKey: event.target.value })}
                className="mt-1 w-full rounded-md border border-line bg-void/70 px-2.5 py-1.5 font-mono text-[11.5px] text-ink transition placeholder:text-faint/60 focus:border-gold/55"
              />
            </div>
          )}
          {meta.secretLabel && (
            <div>
              <label className="font-mono text-[10px] tracking-[0.1em] text-faint uppercase">
                {meta.secretLabel}
              </label>
              <input
                type="password"
                value={config.secretKey}
                spellCheck={false}
                autoComplete="off"
                placeholder="必填"
                onChange={(event) => onChange({ ...config, secretKey: event.target.value })}
                className="mt-1 w-full rounded-md border border-line bg-void/70 px-2.5 py-1.5 font-mono text-[11.5px] text-ink transition placeholder:text-faint/60 focus:border-gold/55"
              />
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
        {meta.note}{' '}
        <a
          href={meta.keyUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-0.5 text-gold/80 hover:text-gold"
        >
          获取 Key
          <ExternalLink className="size-2.5" />
        </a>
      </p>
    </div>
  )
}

export function ApiSettingsModal({
  open,
  onClose,
  settings,
  onSave,
  onReset,
}: ApiSettingsModalProps) {
  const [draft, setDraft] = useState<ApiSettings>(settings)
  const [testingId, setTestingId] = useState<ProviderId | null>(null)
  const draftRef = useRef(draft)
  const abortRef = useRef<AbortController | null>(null)
  const statuses = useProviderStatuses()

  draftRef.current = draft

  useEffect(() => {
    if (open) setDraft(settings)
  }, [open, settings])

  useEffect(() => () => abortRef.current?.abort(), [])

  const statusMap = useMemo(() => new Map(statuses.map((status) => [status.id, status])), [statuses])

  const configuredCount = useMemo(
    () =>
      PROVIDER_IDS.filter((id) =>
        isProviderConfigured(id, draft.providers[id]?.apiKey ?? '', draft.providers[id]?.secretKey ?? ''),
      ).length,
    [draft],
  )

  const patchProvider = (id: ProviderId, next: ProviderConfig) =>
    setDraft((current) => ({ ...current, providers: { ...current.providers, [id]: next } }))

  const runTest = async (id: ProviderId) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setTestingId(id)
    try {
      await testProvider(id, draftRef.current, controller.signal)
    } finally {
      if (!controller.signal.aborted) setTestingId(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="API 设置"
      subtitle="全部密钥仅保存在本机浏览器的 localStorage，不会上传到任何服务器。"
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onReset()
              setDraft(DEFAULT_API_SETTINGS)
            }}
            className="rounded-lg border border-line px-3 py-1.5 font-mono text-[11px] text-dim transition hover:border-bear/50 hover:text-bear"
          >
            清空全部密钥
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line-2 px-3 py-1.5 font-mono text-[11px] text-dim transition hover:text-ink"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                const providers = { ...draft.providers }
                for (const id of PROVIDER_IDS) {
                  const config = providers[id]
                  providers[id] = {
                    apiKey: config?.apiKey?.trim() ?? '',
                    secretKey: config?.secretKey?.trim() ?? '',
                  }
                }
                onSave({
                  geminiKey: draft.geminiKey.trim(),
                  geminiModel: draft.geminiModel.trim() || DEFAULT_GEMINI_MODEL,
                  providers,
                })
                onClose()
              }}
              className="rounded-lg border border-gold/50 bg-gold/15 px-3.5 py-1.5 font-mono text-[11px] font-medium text-gold transition hover:bg-gold/25"
            >
              保存设置
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="panel-flat flex items-start gap-2.5 px-3 py-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-bull" />
          <p className="text-[11.5px] leading-relaxed text-dim">
            终端内置<span className="text-ink">多引擎自动故障转移</span>：当主引擎限流、配额耗尽或报错时，
            会在毫秒级自动切换至下一个可用引擎，确保美股、马股（.KL）与加密货币
            <span className="text-ink">持续输出实时数据</span>。当前已配置
            <span className="text-gold"> {configuredCount} </span>个行情引擎，未配置任何 Key 时自动降级为高仿真基准数据，界面绝不空白。
          </p>
        </div>

        {/* Gemini（AI 翻译 + 跨市场推演） */}
        <div className="rounded-xl border border-gold/25 bg-gold/[0.04] p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold tracking-[0.14em] text-gold uppercase">
              Gemini · AI 翻译与跨市场推演
            </span>
          </div>
          <div className="space-y-3">
            <TextField
              label="Google Gemini API Key"
              hint="用于财经新闻的全自动华文翻译，以及点击新闻时的「AI 跨市场深度推演」（五大资产涨跌概率）。"
              value={draft.geminiKey}
              onChange={(value) => setDraft((current) => ({ ...current, geminiKey: value }))}
              placeholder="例如 AIzaSyD-xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              docsUrl="https://aistudio.google.com/app/apikey"
              docsLabel="前往 Google AI Studio"
            />
            <div>
              <label className="font-mono text-[11px] tracking-[0.1em] text-dim uppercase">
                Gemini 模型
              </label>
              <input
                list="gemini-models"
                value={draft.geminiModel}
                spellCheck={false}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, geminiModel: event.target.value }))
                }
                className="mt-1.5 w-full rounded-lg border border-line bg-void/70 px-3 py-2 font-mono text-[12px] text-ink transition placeholder:text-faint/70 focus:border-gold/55"
              />
              <datalist id="gemini-models">
                {MODEL_SUGGESTIONS.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
              <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                推荐 <span className="font-mono text-dim">gemini-2.5-flash</span>；若模型不可用，系统会自动回退到{' '}
                <span className="font-mono text-dim">gemini-flash-latest</span>。
              </p>
            </div>
          </div>
        </div>

        {/* 行情引擎 */}
        <div>
          <div className="mb-2 font-mono text-[11px] font-semibold tracking-[0.14em] text-dim uppercase">
            行情引擎 · 全部行情数据源
          </div>
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {PROVIDER_IDS.map((id) => (
              <ProviderCard
                key={id}
                id={id}
                config={draft.providers[id] ?? { apiKey: '', secretKey: '' }}
                status={statusMap.get(id)?.health}
                testing={testingId === id}
                onChange={(next) => patchProvider(id, next)}
                onTest={() => runTest(id)}
              />
            ))}
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
            故障转移顺序：美股 Finnhub → Alpaca → FMP → Alpha Vantage → Tiingo → Yahoo → Twelve Data；
            马股 Yahoo → FMP → Twelve Data；加密 Binance → CoinGecko → Yahoo。
            10Y / MAX 长历史请求会优先命中 Tiingo / Yahoo / FMP 等历史深度充足的引擎。
          </p>
        </div>
      </div>
    </Modal>
  )
}
