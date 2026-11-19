import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, ExternalLink, LoaderCircle, PlugZap, ShieldCheck, Cpu, Database } from 'lucide-react'

import type {
  AiFallbackConfig,
  AiFallbackProviderId,
  AiRoutingMode,
  ApiSettings,
  ProviderConfig,
  ProviderHealth,
  ProviderId,
} from '@/types'
import { Modal } from '@/components/ui/Modal'
import {
  AI_BACKUP_PROVIDERS,
  countConfiguredBackupAi,
  isBackupProviderConfigured,
  normalizeAiFallback,
  testBackupProviderClient,
  type AiBackupProviderMeta,
} from '@/lib/aiFallback'
import { TIER_LABEL, TIER_MODEL, TIER_ORDER, TIER_ROLE } from '@/lib/gemini'
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

const ROUTING_OPTIONS: Array<{ key: AiRoutingMode; title: string; desc: string }> = [
  {
    key: 'auto',
    title: '智能三级自动分配（推荐）',
    desc: 'Lite 翻译 + Flash 概率分析 + Pro 深度复盘',
  },
  { key: 'pro', title: '强制全部使用 Gemini 2.5 Pro', desc: '全部任务走旗舰模型，推理最强、配额消耗最高' },
  { key: 'flash', title: '强制全部使用 Gemini 2.5 Flash', desc: '全部任务走均衡主力模型' },
  { key: 'lite', title: '强制全部使用 Flash-Lite', desc: '全部任务走超轻量模型，最省配额' },
]

const MODEL_SUGGESTIONS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
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

interface BackupTestResult {
  state: 'testing' | 'ok' | 'error'
  model?: string
  message?: string
}

function getBackupKeys(id: AiFallbackProviderId, config: AiFallbackConfig): { primary: string; secondary: string } {
  switch (id) {
    case 'groq':
      return { primary: config.groqKey, secondary: '' }
    case 'openrouter':
      return { primary: config.openrouterKey, secondary: '' }
    case 'mistral':
      return { primary: config.mistralKey, secondary: '' }
    case 'cloudflare':
      return { primary: config.cloudflareApiToken, secondary: config.cloudflareAccountId }
    case 'nvidia':
      return { primary: config.nvidiaKey, secondary: '' }
  }
}

function BackupProviderCard({
  meta,
  config,
  status,
  onPatch,
  onTest,
}: {
  meta: AiBackupProviderMeta
  config: AiFallbackConfig
  status?: BackupTestResult
  onPatch: (patch: Partial<AiFallbackConfig>) => void
  onTest: () => void
}) {
  const configured = isBackupProviderConfigured(meta.id, config)
  const testing = status?.state === 'testing'
  const { primary, secondary } = getBackupKeys(meta.id, config)

  const setPrimary = (value: string) => {
    switch (meta.id) {
      case 'groq':
        onPatch({ groqKey: value })
        break
      case 'openrouter':
        onPatch({ openrouterKey: value })
        break
      case 'mistral':
        onPatch({ mistralKey: value })
        break
      case 'cloudflare':
        onPatch({ cloudflareApiToken: value })
        break
      case 'nvidia':
        onPatch({ nvidiaKey: value })
        break
    }
  }

  const dotClass = testing
    ? 'bg-ice'
    : status?.state === 'ok'
      ? 'bg-bull live-dot'
      : status?.state === 'error'
        ? 'bg-bear'
        : configured
          ? 'bg-ice'
          : 'bg-faint'

  const statusText = testing
    ? '测试中…'
    : status?.state === 'ok'
      ? `连通正常${status.model ? ` · ${status.model}` : ''}`
      : status?.state === 'error'
        ? `测试失败${status.message ? `：${status.message.slice(0, 46)}` : ''}`
        : configured
          ? '已就绪 · 随时可顶替'
          : '未配置（自动跳过）'

  const statusTone = testing
    ? 'text-ice'
    : status?.state === 'ok'
      ? 'text-bull'
      : status?.state === 'error'
        ? 'text-bear'
        : configured
          ? 'text-ice'
          : 'text-faint'

  return (
    <div className="rounded-lg border border-line bg-panel-2/60 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('size-2 shrink-0 rounded-full', dotClass)} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn('font-mono text-[12px] font-semibold', meta.accent)}>{meta.label}</span>
              <span className="truncate font-mono text-[10px] text-faint">{meta.vendor}</span>
            </div>
            <div className={cn('truncate font-mono text-[10px]', statusTone)} title={status?.message}>
              {statusText}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onTest}
          disabled={testing || !configured}
          title={configured ? '测试当前备用 AI 连通性' : '请先填入 API Key 后测试'}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line-2 px-2 py-1 font-mono text-[10px] text-dim transition hover:border-ice/50 hover:text-ice disabled:cursor-not-allowed disabled:opacity-40"
        >
          {testing ? <LoaderCircle className="size-3 animate-spin" /> : <PlugZap className="size-3" />}
          测试
        </button>
      </div>

      <div className="mt-2 space-y-2">
        {meta.secondaryLabel && (
          <div>
            <label className="font-mono text-[10px] tracking-[0.1em] text-faint uppercase">
              {meta.secondaryLabel}
            </label>
            <input
              type="text"
              value={secondary}
              spellCheck={false}
              autoComplete="off"
              placeholder={meta.secondaryPlaceholder}
              onChange={(event) => onPatch({ cloudflareAccountId: event.target.value })}
              className="mt-1 w-full rounded-md border border-line bg-void/70 px-2.5 py-1.5 font-mono text-[11.5px] text-ink transition placeholder:text-faint/60 focus:border-ice/55"
            />
          </div>
        )}
        <div>
          <label className="font-mono text-[10px] tracking-[0.1em] text-faint uppercase">
            {meta.keyLabel}
          </label>
          <input
            type="password"
            value={primary}
            spellCheck={false}
            autoComplete="off"
            placeholder={meta.keyPlaceholder}
            onChange={(event) => setPrimary(event.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-void/70 px-2.5 py-1.5 font-mono text-[11.5px] text-ink transition placeholder:text-faint/60 focus:border-ice/55"
          />
        </div>
      </div>

      <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
        <span className="text-dim">{meta.role}：</span>
        {meta.note}{' '}
        <a
          href={meta.docsUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-0.5 text-ice/85 hover:text-ice"
        >
          获取免费 Key
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
  const [draft, setDraft] = useState<ApiSettings>(() => ({
    ...settings,
    aiFallback: normalizeAiFallback(settings.aiFallback),
  }))
  const [activeTab, setActiveTab] = useState<'ai' | 'market'>('ai')
  const [testingId, setTestingId] = useState<ProviderId | null>(null)
  const [backupStatus, setBackupStatus] = useState<Partial<Record<AiFallbackProviderId, BackupTestResult>>>({})
  const draftRef = useRef(draft)
  const abortRef = useRef<AbortController | null>(null)
  const statuses = useProviderStatuses()

  draftRef.current = draft

  useEffect(() => {
    if (open) {
      setDraft({
        ...settings,
        aiFallback: normalizeAiFallback(settings.aiFallback),
      })
      setBackupStatus({})
      setActiveTab('ai')
    }
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

  const fallbackConfig = useMemo(() => normalizeAiFallback(draft.aiFallback), [draft.aiFallback])
  const backupConfiguredCount = useMemo(() => countConfiguredBackupAi(fallbackConfig), [fallbackConfig])

  const patchFallback = (patch: Partial<AiFallbackConfig>) =>
    setDraft((current) => ({
      ...current,
      aiFallback: { ...normalizeAiFallback(current.aiFallback), ...patch },
    }))

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

  const runBackupTest = async (id: AiFallbackProviderId) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBackupStatus((prev) => ({ ...prev, [id]: { state: 'testing' } }))
    const res = await testBackupProviderClient(id, normalizeAiFallback(draftRef.current.aiFallback), controller.signal)
    if (controller.signal.aborted) return
    setBackupStatus((prev) => ({
      ...prev,
      [id]: res.ok
        ? { state: 'ok', model: res.model }
        : { state: 'error', message: res.message ?? '连接失败' },
    }))
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
              setBackupStatus({})
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
                const fb = normalizeAiFallback(draft.aiFallback)
                onSave({
                  geminiKey: draft.geminiKey.trim(),
                  geminiModel: draft.geminiModel.trim(),
                  aiRouting: draft.aiRouting,
                  aiFallback: {
                    enabled: fb.enabled,
                    groqKey: fb.groqKey.trim(),
                    openrouterKey: fb.openrouterKey.trim(),
                    mistralKey: fb.mistralKey.trim(),
                    cloudflareAccountId: fb.cloudflareAccountId.trim(),
                    cloudflareApiToken: fb.cloudflareApiToken.trim(),
                    nvidiaKey: fb.nvidiaKey.trim(),
                  },
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
      <div className="space-y-4">
        {/* 顶部 Tab 导航：一打开默认显示 AI 与免费备用服务商，绝不遗漏 */}
        <div className="flex items-center gap-2 border-b border-line pb-3">
          <button
            type="button"
            onClick={() => setActiveTab('ai')}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[11.5px] font-medium transition',
              activeTab === 'ai'
                ? 'border border-gold/40 bg-gold/15 text-gold shadow-sm'
                : 'border border-line bg-void/55 text-dim hover:text-ink',
            )}
          >
            <Cpu className="size-3.5" />
            AI 主力与免费备用引擎 ({backupConfiguredCount + (draft.geminiKey.trim() ? 1 : 0)})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('market')}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[11.5px] font-medium transition',
              activeTab === 'market'
                ? 'border border-ice/40 bg-ice/15 text-ice shadow-sm'
                : 'border border-line bg-void/55 text-dim hover:text-ink',
            )}
          >
            <Database className="size-3.5" />
            行情数据引擎 ({configuredCount} / {PROVIDER_IDS.length})
          </button>
        </div>

        {activeTab === 'ai' ? (
          <div className="space-y-5">
            <div className="panel-flat flex items-start gap-2.5 px-3 py-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-bull" />
              <p className="text-[11.5px] leading-relaxed text-dim">
                终端内置<span className="text-ink">多引擎自动故障转移与免费服务商兜底</span>：Gemini 保持绝对第一主力；
                当遇到 429 限流、配额耗尽或并发排队时，自动无缝切换至下方已配置的永久免费备用服务商（Groq、OpenRouter、Mistral、Cloudflare）。
              </p>
            </div>

            {/* 核心：永久免费多服务商兜底与并发分流（排在最显眼位置） */}
            <div className="rounded-xl border border-ice/25 bg-ice/[0.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold tracking-[0.14em] text-ice uppercase">
                    永久免费多服务商兜底与并发分流（备用援军）
                  </span>
                  <span className="rounded border border-ice/35 bg-ice/10 px-1.5 py-[1px] font-mono text-[10px] text-ice">
                    已配置 {backupConfiguredCount} / 5 个
                  </span>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={fallbackConfig.enabled}
                  onClick={() => patchFallback({ enabled: !fallbackConfig.enabled })}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 font-mono text-[10.5px] transition',
                    fallbackConfig.enabled
                      ? 'border-bull/50 bg-bull/12 text-bull'
                      : 'border-line-2 bg-void/60 text-faint hover:text-dim',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block size-2 rounded-full',
                      fallbackConfig.enabled ? 'bg-bull' : 'bg-faint',
                    )}
                  />
                  故障转移开关：{fallbackConfig.enabled ? '已开启' : '已关闭'}
                </button>
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-dim">
                请在此处直接填写四大永久免费 AI 服务商的 API Key（未填写的服务商将自动跳过）：
              </p>

              <div className="mt-3 space-y-3">
                <div>
                  <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-ice uppercase">
                    前 4 大永久免费主力替补（Groq / OpenRouter / Mistral / Cloudflare）
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                    {AI_BACKUP_PROVIDERS.filter((m) => m.id !== 'nvidia').map((meta) => (
                      <BackupProviderCard
                        key={meta.id}
                        meta={meta}
                        config={fallbackConfig}
                        status={backupStatus[meta.id]}
                        onPatch={patchFallback}
                        onTest={() => void runBackupTest(meta.id)}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-faint uppercase">
                    其它深度备用引擎（可选）
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                    {AI_BACKUP_PROVIDERS.filter((m) => m.id === 'nvidia').map((meta) => (
                      <BackupProviderCard
                        key={meta.id}
                        meta={meta}
                        config={fallbackConfig}
                        status={backupStatus[meta.id]}
                        onPatch={patchFallback}
                        onTest={() => void runBackupTest(meta.id)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Gemini（AI 主力） */}
            <div className="rounded-xl border border-gold/25 bg-gold/[0.04] p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-mono text-[11px] font-semibold tracking-[0.14em] text-gold uppercase">
                  Gemini · 第一主力 AI 引擎
                </span>
              </div>
              <div className="space-y-3.5">
                <TextField
                  label="Google Gemini API Key"
                  hint="用于新闻华文翻译、跨市场涨跌概率推演、个股诊断与交易复盘；模型将按下方路由模式自动分配。"
                  value={draft.geminiKey}
                  onChange={(value) => setDraft((current) => ({ ...current, geminiKey: value }))}
                  placeholder="例如 AIzaSyD-xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  docsUrl="https://aistudio.google.com/app/apikey"
                  docsLabel="前往 Google AI Studio"
                />

                {/* AI 模型路由模式 */}
                <div>
                  <label className="font-mono text-[11px] tracking-[0.1em] text-dim uppercase">
                    AI 模型路由模式
                  </label>
                  <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {ROUTING_OPTIONS.map((option) => {
                      const active = draft.aiRouting === option.key
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() =>
                            setDraft((current) => ({ ...current, aiRouting: option.key }))
                          }
                          className={cn(
                            'rounded-lg border px-2.5 py-2 text-left transition',
                            active
                              ? 'border-gold/55 bg-gold/12'
                              : 'border-line bg-void/50 hover:border-line-2',
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                'size-2.5 shrink-0 rounded-full border',
                                active ? 'border-gold bg-gold' : 'border-faint',
                              )}
                            />
                            <span
                              className={cn(
                                'font-mono text-[11px] font-medium',
                                active ? 'text-gold' : 'text-dim',
                              )}
                            >
                              {option.title}
                            </span>
                            {option.key === 'auto' && (
                              <span className="rounded border border-bull/40 bg-bull/10 px-1 py-[1px] font-mono text-[9px] text-bull">
                                默认
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[10.5px] leading-relaxed text-faint">{option.desc}</p>
                        </button>
                      )
                    })}
                  </div>

                  {/* 三级模型职责与降级链 */}
                  <div className="mt-2 rounded-lg border border-line bg-void/40 p-2.5">
                    <div className="mb-1.5 font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">
                      三级模型分工
                    </div>
                    <ul className="space-y-1">
                      {[...TIER_ORDER].reverse().map((tier) => (
                        <li key={tier} className="flex flex-wrap items-baseline gap-x-2 text-[10.5px]">
                          <span className="font-mono text-[11px] font-medium text-ink">
                            {TIER_LABEL[tier]}
                          </span>
                          <span className="font-mono text-[9.5px] text-faint">{TIER_MODEL[tier]}</span>
                          <span className="text-faint">{TIER_ROLE[tier]}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* 高级：自定义模型覆盖 */}
                <div>
                  <label className="font-mono text-[11px] tracking-[0.1em] text-dim uppercase">
                    自定义模型覆盖（高级 · 可选）
                  </label>
                  <input
                    list="gemini-models"
                    value={draft.geminiModel}
                    spellCheck={false}
                    placeholder="留空则由上方路由模式自动决定"
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
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* 行情引擎 Tab */
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
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
