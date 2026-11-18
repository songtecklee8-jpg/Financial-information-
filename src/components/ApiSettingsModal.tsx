import { useEffect, useState } from 'react'
import { Eye, EyeOff, ExternalLink, ShieldCheck } from 'lucide-react'

import type { ApiSettings } from '@/types'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { DEFAULT_GEMINI_MODEL } from '@/lib/gemini'

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

function SecretField({
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
      <div className="flex items-center justify-between gap-2">
        <label className="font-mono text-[11px] tracking-[0.1em] text-dim uppercase">{label}</label>
        {value.trim() ? (
          <Badge tone="bull" dot>
            已配置
          </Badge>
        ) : (
          <Badge tone="neutral">未配置</Badge>
        )}
      </div>
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

export function ApiSettingsModal({
  open,
  onClose,
  settings,
  onSave,
  onReset,
}: ApiSettingsModalProps) {
  const [draft, setDraft] = useState<ApiSettings>(settings)

  useEffect(() => {
    if (open) setDraft(settings)
  }, [open, settings])

  const patch = (partial: Partial<ApiSettings>) => setDraft((current) => ({ ...current, ...partial }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="API 设置"
      subtitle="密钥仅保存在本机浏览器的 localStorage，不会上传到任何服务器。"
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onReset()
              setDraft({ twelveDataKey: '', geminiKey: '', geminiModel: DEFAULT_GEMINI_MODEL })
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
                onSave({
                  twelveDataKey: draft.twelveDataKey.trim(),
                  geminiKey: draft.geminiKey.trim(),
                  geminiModel: draft.geminiModel.trim() || DEFAULT_GEMINI_MODEL,
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
            未配置密钥时，终端会自动降级为<span className="text-ink">高仿真基准数据</span>
            （含模拟微幅波动），所有估值指标、内在价值与评分仍会完整计算，界面绝不空白。
            填入 Key 后即切换为实时数据，顶栏徽章会同步变为
            <span className="text-bull"> LIVE</span>。
          </p>
        </div>

        <SecretField
          label="Twelve Data API Key"
          hint="用于拉取美股与 Bursa 马股的实时行情、基本面与日线序列。免费额度为每分钟 8 次请求，未填 Key 或超限时自动回退基准数据。"
          value={draft.twelveDataKey}
          onChange={(value) => patch({ twelveDataKey: value })}
          placeholder="例如 8f2c1a9d4b7e6f3a0d5c8b1e2a7f9c4d"
          docsUrl="https://twelvedata.com/pricing"
          docsLabel="获取免费 Key"
        />

        <SecretField
          label="Google Gemini API Key"
          hint="用于「AI 综合价值裁决」深度诊断与右下角 AI 金融研究助理。Recommendation: 使用 gemini-2.5-flash 以兼顾速度与成本。"
          value={draft.geminiKey}
          onChange={(value) => patch({ geminiKey: value })}
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
            onChange={(event) => patch({ geminiModel: event.target.value })}
            className="mt-1.5 w-full rounded-lg border border-line bg-void/70 px-3 py-2 font-mono text-[12px] text-ink transition placeholder:text-faint/70 focus:border-gold/55"
          />
          <datalist id="gemini-models">
            {MODEL_SUGGESTIONS.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
            若所选模型不可用，系统会自动回退到 <span className="font-mono text-dim">gemini-flash-latest</span>。
          </p>
        </div>
      </div>
    </Modal>
  )
}
