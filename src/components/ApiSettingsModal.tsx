import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  Newspaper,
  PlugZap,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'

import type {
  AiFallbackConfig,
  AiFallbackProviderId,
  AiRoutingMode,
  AllAiProviderId,
  ApiSettings,
  ServerEnvStatus,
} from '@/types'
import { Modal } from '@/components/ui/Modal'
import {
  AI_BACKUP_PROVIDERS,
  collectClientGeminiKeys,
  countConfiguredBackupAi,
  isBackupProviderConfigured,
  normalizeAiFallback,
  testRelayBatonClient,
  type AiBackupProviderMeta,
} from '@/lib/aiFallback'
import { TIER_LABEL, TIER_MODEL, TIER_ORDER, TIER_ROLE } from '@/lib/gemini'
import { DEFAULT_API_SETTINGS } from '@/hooks/useApiSettings'
import { cn } from '@/lib/cn'
import { PROVIDER_IDS } from '@/lib/market/registry'

interface ApiSettingsModalProps {
  open: boolean
  onClose: () => void
  settings: ApiSettings
  serverEnv: ServerEnvStatus | null
  onRefreshServerEnv: () => Promise<void>
  onSave: (next: ApiSettings) => void
  onReset: () => void
}

const ROUTING_OPTIONS: Array<{ key: AiRoutingMode; title: string; desc: string }> = [
  {
    key: 'auto',
    title: '智能三级自动分配（推荐）',
    desc: '优先 Gemini 2.5 Flash / Pro 按任务复杂度调度',
  },
  { key: 'pro', title: '优先 Gemini 2.5 Pro', desc: '深度财报解析与 CFA 复杂公式推理首选' },
  { key: 'flash', title: '优先 Gemini 2.5 Flash', desc: '速度与精度均衡的主力通道' },
  { key: 'lite', title: '优先 Gemini Flash-Lite', desc: '超轻量响应，最大程度节省配额' },
]

const MODEL_SUGGESTIONS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
]

interface BatonTestResult {
  state: 'testing' | 'ok' | 'error'
  model?: string
  message?: string
}

function SecretInput({
  label,
  value,
  onChange,
  placeholder,
  envReady,
  inputType = 'password',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  envReady?: boolean
  inputType?: 'password' | 'text'
}) {
  const [visible, setVisible] = useState(inputType === 'text')
  const isSecret = inputType === 'password'

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label className="font-mono text-[10px] tracking-[0.08em] text-dim uppercase">{label}</label>
        {envReady && (
          <span className="font-mono text-[9.5px] text-bull">服务端环境变量已生效</span>
        )}
      </div>
      <div className="relative mt-1">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder={envReady ? '服务端已配置（如需覆盖可留空，仅作备用补充）' : placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-md border border-line bg-void/70 py-1.5 pr-8 pl-2.5 font-mono text-[11.5px] text-ink transition placeholder:text-faint/60 focus:border-gold/55"
        />
        {isSecret && (
          <button
            type="button"
            onClick={() => setVisible((s) => !s)}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-faint transition hover:text-ink"
            aria-label={visible ? '隐藏密钥' : '显示密钥'}
          >
            {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        )}
      </div>
    </div>
  )
}

function getBatonValues(
  id: AiFallbackProviderId,
  config: AiFallbackConfig,
): { primary: string; secondary: string; model: string } {
  switch (id) {
    case 'groq':
      return { primary: config.groqKey, secondary: '', model: '' }
    case 'openrouter':
      return { primary: config.openrouterKey, secondary: '', model: '' }
    case 'cerebras':
      return { primary: config.cerebrasKey, secondary: '', model: '' }
    case 'nvidia':
      return { primary: config.nvidiaKey, secondary: '', model: '' }
    case 'cloudflare':
      return { primary: config.cloudflareApiToken, secondary: config.cloudflareAccountId, model: '' }
    case 'mistral':
      return { primary: config.mistralKey, secondary: '', model: '' }
    case 'cohere':
      return { primary: config.cohereKey, secondary: '', model: '' }
    case 'custom1':
      return { primary: config.custom1Key, secondary: config.custom1Url, model: config.custom1Model }
    case 'custom2':
      return { primary: config.custom2Key, secondary: config.custom2Url, model: config.custom2Model }
  }
}

function BatonProviderCard({
  meta,
  config,
  envReady,
  status,
  onPatch,
  onTest,
}: {
  meta: AiBackupProviderMeta
  config: AiFallbackConfig
  envReady: boolean
  status?: BatonTestResult
  onPatch: (patch: Partial<AiFallbackConfig>) => void
  onTest: () => void
}) {
  const localConfigured = isBackupProviderConfigured(meta.id, config)
  const configured = localConfigured || envReady
  const testing = status?.state === 'testing'
  const { primary, secondary, model } = getBatonValues(meta.id, config)

  const setPrimary = (value: string) => {
    switch (meta.id) {
      case 'groq':
        onPatch({ groqKey: value })
        break
      case 'openrouter':
        onPatch({ openrouterKey: value })
        break
      case 'cerebras':
        onPatch({ cerebrasKey: value })
        break
      case 'nvidia':
        onPatch({ nvidiaKey: value })
        break
      case 'cloudflare':
        onPatch({ cloudflareApiToken: value })
        break
      case 'mistral':
        onPatch({ mistralKey: value })
        break
      case 'cohere':
        onPatch({ cohereKey: value })
        break
      case 'custom1':
        onPatch({ custom1Key: value })
        break
      case 'custom2':
        onPatch({ custom2Key: value })
        break
    }
  }

  const setSecondary = (value: string) => {
    if (meta.id === 'cloudflare') onPatch({ cloudflareAccountId: value })
    else if (meta.id === 'custom1') onPatch({ custom1Url: value })
    else if (meta.id === 'custom2') onPatch({ custom2Url: value })
  }

  const setModel = (value: string) => {
    if (meta.id === 'custom1') onPatch({ custom1Model: value })
    else if (meta.id === 'custom2') onPatch({ custom2Model: value })
  }

  const dotClass = testing
    ? 'bg-ice'
    : status?.state === 'ok'
      ? 'bg-bull'
      : status?.state === 'error'
        ? 'bg-bear'
        : configured
          ? 'bg-ice'
          : 'bg-faint'

  const statusText = testing
    ? '正在测试连通性…'
    : status?.state === 'ok'
      ? `连通正常${status.model ? ` · ${status.model}` : ''}`
      : status?.state === 'error'
        ? `测试失败：${status.message ?? '请求异常'}`
        : envReady
          ? 'Vercel 环境变量已就绪（接力候选）'
          : localConfigured
            ? '本地已配置 · 经安全代理/直连接力'
            : '未配置（自动跳过至下一棒）'

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
    <div className="rounded-lg border border-line bg-panel-2/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('size-2 shrink-0 rounded-full', dotClass)} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn('font-mono text-[12px] font-semibold', meta.accent)}>
                {meta.label}
              </span>
              <span className="truncate font-mono text-[9.5px] text-faint">{meta.vendor}</span>
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
          title={configured ? '一键测试此接力棒连通性' : '请先填入 API Key 或在 Vercel 配置环境变量'}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line-2 px-2 py-1 font-mono text-[10px] text-dim transition hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed disabled:opacity-40"
        >
          {testing ? <LoaderCircle className="size-3 animate-spin" /> : <PlugZap className="size-3" />}
          测试连通性
        </button>
      </div>

      <div className="mt-2.5 space-y-2">
        {meta.secondaryLabel && (
          <SecretInput
            label={meta.secondaryLabel}
            value={secondary}
            onChange={setSecondary}
            placeholder={meta.secondaryPlaceholder ?? ''}
            envReady={envReady && meta.id === 'cloudflare'}
            inputType="text"
          />
        )}
        <SecretInput
          label={meta.keyLabel}
          value={primary}
          onChange={setPrimary}
          placeholder={meta.keyPlaceholder}
          envReady={envReady}
          inputType="password"
        />
        {meta.modelLabel && (
          <SecretInput
            label={meta.modelLabel}
            value={model}
            onChange={setModel}
            placeholder={meta.modelPlaceholder ?? ''}
            inputType="text"
          />
        )}
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
  serverEnv,
  onRefreshServerEnv,
  onSave,
  onReset,
}: ApiSettingsModalProps) {
  const [draft, setDraft] = useState<ApiSettings>(() => ({
    ...settings,
    aiFallback: normalizeAiFallback(settings.aiFallback),
  }))
  const [activeTab, setActiveTab] = useState<'ai' | 'news'>('ai')
  const [batonStatus, setBatonStatus] = useState<Partial<Record<AllAiProviderId, BatonTestResult>>>({})
  const [refreshingEnv, setRefreshingEnv] = useState(false)
  const draftRef = useRef(draft)
  const abortRef = useRef<AbortController | null>(null)

  draftRef.current = draft

  useEffect(() => {
    if (open) {
      setDraft({
        ...settings,
        aiFallback: normalizeAiFallback(settings.aiFallback),
      })
      setBatonStatus({})
      setActiveTab('ai')
    }
  }, [open, settings])

  useEffect(() => () => abortRef.current?.abort(), [])

  const fallbackConfig = useMemo(() => normalizeAiFallback(draft.aiFallback), [draft.aiFallback])
  const backupConfiguredCount = useMemo(() => countConfiguredBackupAi(fallbackConfig), [fallbackConfig])
  const clientGeminiCount = useMemo(() => collectClientGeminiKeys(draft).length, [draft])
  const totalGeminiReady = Math.max(clientGeminiCount, serverEnv?.geminiCount ?? 0)
  const totalRelayReady = backupConfiguredCount + (totalGeminiReady > 0 ? 1 : 0)

  const patchFallback = (patch: Partial<AiFallbackConfig>) =>
    setDraft((current) => ({
      ...current,
      aiFallback: { ...normalizeAiFallback(current.aiFallback), ...patch },
    }))

  const runBatonTest = async (id: AllAiProviderId) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBatonStatus((prev) => ({ ...prev, [id]: { state: 'testing' } }))
    const res = await testRelayBatonClient(
      id,
      {
        geminiKey: draftRef.current.geminiKey,
        aiFallback: normalizeAiFallback(draftRef.current.aiFallback),
      },
      controller.signal,
    )
    if (controller.signal.aborted) return
    setBatonStatus((prev) => ({
      ...prev,
      [id]: res.ok
        ? { state: 'ok', model: res.model }
        : { state: 'error', message: res.message ?? '连接失败' },
    }))
  }

  const handleRefreshEnv = async () => {
    setRefreshingEnv(true)
    try {
      await onRefreshServerEnv()
    } finally {
      setRefreshingEnv(false)
    }
  }

  const geminiStatus = batonStatus.gemini
  const geminiTesting = geminiStatus?.state === 'testing'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="API 接力赛配置"
      subtitle="严格第 1→10 棒自动故障转移 · 服务端 Vercel 环境变量优先，本地填写仅存浏览器 localStorage 并经后端代理转发"
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onReset()
              setDraft(DEFAULT_API_SETTINGS)
              setBatonStatus({})
            }}
            className="rounded-lg border border-line px-3 py-1.5 font-mono text-[11px] text-dim transition hover:border-bear/50 hover:text-bear"
          >
            清空本地全部密钥
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
                    geminiKey2: fb.geminiKey2.trim(),
                    geminiKey3: fb.geminiKey3.trim(),
                    groqKey: fb.groqKey.trim(),
                    openrouterKey: fb.openrouterKey.trim(),
                    cerebrasKey: fb.cerebrasKey.trim(),
                    nvidiaKey: fb.nvidiaKey.trim(),
                    cloudflareAccountId: fb.cloudflareAccountId.trim(),
                    cloudflareApiToken: fb.cloudflareApiToken.trim(),
                    mistralKey: fb.mistralKey.trim(),
                    cohereKey: fb.cohereKey.trim(),
                    custom1Url: fb.custom1Url.trim(),
                    custom1Key: fb.custom1Key.trim(),
                    custom1Model: fb.custom1Model.trim(),
                    custom2Url: fb.custom2Url.trim(),
                    custom2Key: fb.custom2Key.trim(),
                    custom2Model: fb.custom2Model.trim(),
                  },
                  newsDataKey: draft.newsDataKey?.trim() ?? '',
                  providers,
                })
                onClose()
              }}
              className="rounded-lg border border-gold/50 bg-gold/15 px-3.5 py-1.5 font-mono text-[11px] font-medium text-gold transition hover:bg-gold/25"
            >
              保存接力赛配置
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 顶部 Tab 导航：AI 接力赛（10 棒） / 财经新闻接口 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('ai')}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[11.5px] font-medium transition',
                activeTab === 'ai'
                  ? 'border border-gold/40 bg-gold/15 text-gold'
                  : 'border border-line bg-void/55 text-dim hover:text-ink',
              )}
            >
              <Cpu className="size-3.5" />
              10 棒 AI 接力通道（已就绪 {totalRelayReady} / 10 棒）
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('news')}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[11.5px] font-medium transition',
                activeTab === 'news'
                  ? 'border border-bull/40 bg-bull/15 text-bull'
                  : 'border border-line bg-void/55 text-dim hover:text-ink',
              )}
            >
              <Newspaper className="size-3.5" />
              财经新闻接口（NewsData.io & Finnhub）
            </button>
          </div>

          <button
            type="button"
            onClick={() => void handleRefreshEnv()}
            disabled={refreshingEnv}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-[10px] text-dim transition hover:border-ice/50 hover:text-ice"
          >
            <RefreshCw className={cn('size-3', refreshingEnv && 'animate-spin')} />
            同步服务端环境变量状态
          </button>
        </div>

        {activeTab === 'ai' ? (
          <div className="space-y-4">
            {/* 接力秩序说明 */}
            <div className="panel-flat flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
              <div className="flex min-w-0 items-start gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-bull" />
                <p className="text-[11px] leading-relaxed text-dim">
                  严格接力顺序：<span className="text-gold">① Gemini（多 Key 轮询）</span> → ② Groq → ③
                  OpenRouter → ④ Cerebras → ⑤ NVIDIA NIM → ⑥ Cloudflare → ⑦ Mistral → ⑧ Cohere → ⑨/⑩
                  自定义 OpenAI。遇到 429 限流、5xx 或超时秒切下一棒。
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={fallbackConfig.enabled}
                onClick={() => patchFallback({ enabled: !fallbackConfig.enabled })}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1 font-mono text-[10.5px] transition',
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
                自动接力容错：{fallbackConfig.enabled ? '已开启' : '已关闭'}
              </button>
            </div>

            {/* 第 1 棒：Google Gemini（多 Key 内部轮询） */}
            <div className="rounded-xl border border-gold/30 bg-gold/[0.04] p-3.5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] font-semibold text-gold">
                      第 1 棒 · Google Gemini（绝对主力 · 多 Key 内部轮询）
                    </span>
                    <span className="font-mono text-[10px] text-faint">
                      就绪密钥 {totalGeminiReady} 把
                    </span>
                  </div>
                  <div
                    className={cn(
                      'mt-0.5 font-mono text-[10px]',
                      geminiTesting
                        ? 'text-ice'
                        : geminiStatus?.state === 'ok'
                          ? 'text-bull'
                          : geminiStatus?.state === 'error'
                            ? 'text-bear'
                            : totalGeminiReady > 0
                              ? 'text-bull'
                              : 'text-faint',
                    )}
                  >
                    {geminiTesting
                      ? '正在测试第 1 棒 Gemini 连通性…'
                      : geminiStatus?.state === 'ok'
                        ? `连通正常 · ${geminiStatus.model}`
                        : geminiStatus?.state === 'error'
                          ? `测试失败：${geminiStatus.message}`
                          : totalGeminiReady > 0
                            ? '第 1 棒就绪，所有 AI 任务绝对优先调度 Gemini'
                            : '未配置 Gemini Key（将直接从第 2 棒起跑）'}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-0.5 font-mono text-[10px] text-gold/85 hover:text-gold"
                  >
                    获取 Key
                    <ExternalLink className="size-2.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => void runBatonTest('gemini')}
                    disabled={geminiTesting || totalGeminiReady === 0}
                    className="inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-2.5 py-1 font-mono text-[10px] text-gold transition hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {geminiTesting ? (
                      <LoaderCircle className="size-3 animate-spin" />
                    ) : (
                      <PlugZap className="size-3" />
                    )}
                    测试第 1 棒
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
                <SecretInput
                  label="Gemini Key #1 (GEMINI_API_KEY)"
                  value={draft.geminiKey}
                  onChange={(value) => setDraft((c) => ({ ...c, geminiKey: value }))}
                  placeholder="AIzaSy..."
                  envReady={serverEnv?.gemini1}
                />
                <SecretInput
                  label="Gemini Key #2 (GEMINI_API_KEY_2)"
                  value={fallbackConfig.geminiKey2}
                  onChange={(value) => patchFallback({ geminiKey2: value })}
                  placeholder="可选第 2 把 Gemini Key"
                  envReady={serverEnv?.gemini2}
                />
                <SecretInput
                  label="Gemini Key #3 (GEMINI_API_KEY_3)"
                  value={fallbackConfig.geminiKey3}
                  onChange={(value) => patchFallback({ geminiKey3: value })}
                  placeholder="可选第 3 把 Gemini Key"
                  envReady={serverEnv?.gemini3}
                />
              </div>

              {/* 路由模式与模型覆盖 */}
              <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2 lg:grid-cols-4">
                {ROUTING_OPTIONS.map((option) => {
                  const active = draft.aiRouting === option.key
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, aiRouting: option.key }))}
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
                            'size-2 shrink-0 rounded-full border',
                            active ? 'border-gold bg-gold' : 'border-faint',
                          )}
                        />
                        <span
                          className={cn(
                            'font-mono text-[10.5px] font-medium',
                            active ? 'text-gold' : 'text-dim',
                          )}
                        >
                          {option.title}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-faint">{option.desc}</p>
                    </button>
                  )
                })}
              </div>

              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                <div>
                  <label className="font-mono text-[10px] tracking-[0.08em] text-dim uppercase">
                    自定义优先模型覆盖（留空自动调度）
                  </label>
                  <input
                    list="gemini-models"
                    value={draft.geminiModel}
                    spellCheck={false}
                    placeholder="默认：gemini-2.5-flash / gemini-2.5-pro"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, geminiModel: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-line bg-void/70 px-2.5 py-1.5 font-mono text-[11.5px] text-ink transition placeholder:text-faint/60 focus:border-gold/55"
                  />
                  <datalist id="gemini-models">
                    {MODEL_SUGGESTIONS.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </div>
                <div className="rounded-md border border-line bg-void/40 px-2.5 py-1.5">
                  <div className="font-mono text-[9.5px] tracking-[0.1em] text-faint uppercase">
                    第 1 棒三级降级链路
                  </div>
                  <div className="mt-1 space-y-0.5 text-[10px] text-faint">
                    {[...TIER_ORDER].reverse().map((tier) => (
                      <div key={tier} className="truncate">
                        <span className="font-mono text-dim">{TIER_LABEL[tier]}</span> ·{' '}
                        <span className="font-mono text-faint">{TIER_MODEL[tier]}</span> ·{' '}
                        {TIER_ROLE[tier]}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 第 2–10 棒 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold tracking-[0.1em] text-ice uppercase">
                  第 2–10 棒 · 免费与自定义 AI 接力通道
                </span>
                <span className="font-mono text-[10px] text-faint">
                  已就绪 {backupConfiguredCount} / 9 棒
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                {AI_BACKUP_PROVIDERS.map((meta) => (
                  <BatonProviderCard
                    key={meta.id}
                    meta={meta}
                    config={fallbackConfig}
                    envReady={Boolean(serverEnv?.[meta.id])}
                    status={batonStatus[meta.id]}
                    onPatch={patchFallback}
                    onTest={() => void runBatonTest(meta.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="panel-flat flex items-start gap-2.5 px-3 py-2.5">
              <Newspaper className="mt-0.5 size-4 shrink-0 text-bull" />
              <p className="text-[11.5px] leading-relaxed text-dim">
                用于「新闻情报与 AI 摘要」页输入公司名称或关键词拉取最新实时财经快讯；服务端环境变量（
                <span className="font-mono text-ink">NEWS_DATA_API_KEY / FINNHUB_API_KEY</span>
                ）优先生效，未填写环境变量时使用下方本地密钥。
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-bull/25 bg-bull/[0.03] p-3.5 space-y-2">
                <SecretInput
                  label="NewsData.io API Key (NEWS_DATA_API_KEY)"
                  value={draft.newsDataKey ?? ''}
                  onChange={(value) => setDraft((c) => ({ ...c, newsDataKey: value }))}
                  placeholder="pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  envReady={serverEnv?.newsdata}
                />
                <p className="text-[10.5px] leading-relaxed text-faint">
                  支持按公司名/关键词即时搜索美股、马股及全球商业财经新闻。{' '}
                  <a
                    href="https://newsdata.io/register"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-0.5 text-bull hover:underline"
                  >
                    申请免费 Key <ExternalLink className="size-2.5" />
                  </a>
                </p>
              </div>

              <div className="rounded-xl border border-ice/25 bg-ice/[0.03] p-3.5 space-y-2">
                <SecretInput
                  label="Finnhub API Key (FINNHUB_API_KEY)"
                  value={draft.providers?.finnhub?.apiKey ?? ''}
                  onChange={(value) =>
                    setDraft((c) => ({
                      ...c,
                      providers: {
                        ...c.providers,
                        finnhub: { apiKey: value, secretKey: '' },
                      },
                    }))
                  }
                  placeholder="输入 Finnhub API Key"
                  envReady={serverEnv?.finnhub}
                />
                <p className="text-[10.5px] leading-relaxed text-faint">
                  用于按股票代码（如 AAPL、NVDA、TSLA）拉取官方公司新闻快讯。{' '}
                  <a
                    href="https://finnhub.io/register"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-0.5 text-ice hover:underline"
                  >
                    申请免费 Key <ExternalLink className="size-2.5" />
                  </a>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
