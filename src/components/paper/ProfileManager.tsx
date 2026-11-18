import { useEffect, useState } from 'react'
import { Building, Plus, Settings2, Trash2, Pencil, Wallet } from 'lucide-react'

import type { Currency, PaperProfile } from '@/types'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/cn'
import { formatPrice } from '@/lib/format'

interface ProfileManagerProps {
  profiles: PaperProfile[]
  activeId: string | null
  active: PaperProfile | null
  onSwitch: (id: string) => void
  onCreate: (name: string, currency: Currency, capital: number) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onResetCapital: (id: string, amount: number) => void
  onDeposit: (id: string, amount: number) => void
  onSetFxRate: (id: string, rate: number) => void
}

const CURRENCY_LABEL: Record<Currency, string> = { USD: '美元 USD', MYR: '令吉 MYR' }

const PRESETS: Array<{ name: string; currency: Currency; capital: number }> = [
  { name: '美股科技波段账户', currency: 'USD', capital: 100_000 },
  { name: '马股高股息长线账户', currency: 'MYR', capital: 200_000 },
  { name: '激进期权 / 短线测试账户', currency: 'USD', capital: 25_000 },
]

export function ProfileManager(props: ProfileManagerProps) {
  const { profiles, activeId, active } = props
  const [createOpen, setCreateOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [fundOpen, setFundOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <section className="panel hairline-top p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 pr-1">
          <Building className="size-3.5 text-gold" />
          <span className="font-mono text-[10px] tracking-[0.16em] text-faint uppercase">账户档案</span>
        </div>

        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {profiles.map((profile) => {
            const isActive = profile.id === activeId
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => props.onSwitch(profile.id)}
                className={cn(
                  'group flex shrink-0 flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition',
                  isActive
                    ? 'border-gold/55 bg-gold/12'
                    : 'border-line bg-panel-2 hover:border-line-2',
                )}
              >
                <span className={cn('max-w-[180px] truncate text-[11.5px] font-medium', isActive ? 'text-gold' : 'text-ink')}>
                  {profile.name}
                </span>
                <span className="font-mono text-[9.5px] text-faint">
                  {profile.currency} · 初始 {formatPrice(profile.initialCapital, profile.currency)}
                </span>
              </button>
            )
          })}
          {profiles.length === 0 && <span className="text-[11px] text-faint">暂无账户，请新建</span>}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-gold/45 bg-gold/10 px-2.5 py-1.5 font-mono text-[11px] text-gold transition hover:bg-gold/20"
          >
            <Plus className="size-3.5" /> 新建账户
          </button>
          {active && (
            <>
              <button
                type="button"
                onClick={() => setRenameOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-line-2 px-2 py-1.5 font-mono text-[11px] text-dim transition hover:border-gold/50 hover:text-gold"
                title="重命名当前账户"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setFundOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-line-2 px-2 py-1.5 font-mono text-[11px] text-dim transition hover:border-gold/50 hover:text-gold"
                title="调整本金 / 追加资金 / 汇率"
              >
                <Settings2 className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-line-2 px-2 py-1.5 font-mono text-[11px] text-dim transition hover:border-bear/50 hover:text-bear"
                title="删除当前账户"
              >
                <Trash2 className="size-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <CreateProfileModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={props.onCreate} />
      {active && (
        <>
          <RenameModal
            open={renameOpen}
            initial={active.name}
            onClose={() => setRenameOpen(false)}
            onSubmit={(name) => props.onRename(active.id, name)}
          />
          <FundModal
            open={fundOpen}
            profile={active}
            onClose={() => setFundOpen(false)}
            onResetCapital={(amount) => props.onResetCapital(active.id, amount)}
            onDeposit={(amount) => props.onDeposit(active.id, amount)}
            onSetFxRate={(rate) => props.onSetFxRate(active.id, rate)}
          />
          <ConfirmModal
            open={deleteOpen}
            title="删除账户"
            message={`确认删除「${active.name}」？该账户的全部持仓与交易流水将被永久清除，且不可恢复。`}
            onClose={() => setDeleteOpen(false)}
            onConfirm={() => {
              props.onDelete(active.id)
              setDeleteOpen(false)
            }}
          />
        </>
      )}
    </section>
  )
}

function CreateProfileModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (name: string, currency: Currency, capital: number) => void
}) {
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState<Currency>('USD')
  const [capital, setCapital] = useState('100000')

  useEffect(() => {
    if (open) {
      setName('')
      setCurrency('USD')
      setCapital('100000')
    }
  }, [open])

  const submit = () => {
    const amount = Number(capital)
    if (!Number.isFinite(amount) || amount <= 0) return
    onCreate(name.trim() || '新建账户', currency, amount)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建交易账户（Profile）"
      subtitle="每个账户独立核算本金、持仓与盈亏，互不影响。"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-line-2 px-3 py-1.5 font-mono text-[11px] text-dim transition hover:text-ink">
            取消
          </button>
          <button type="button" onClick={submit} className="rounded-lg border border-gold/50 bg-gold/15 px-3 py-1.5 font-mono text-[11px] text-gold transition hover:bg-gold/25">
            创建
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => {
                setName(preset.name)
                setCurrency(preset.currency)
                setCapital(String(preset.capital))
              }}
              className="rounded-full border border-line bg-panel-2 px-2.5 py-1 font-mono text-[10.5px] text-dim transition hover:border-gold/50 hover:text-gold"
            >
              {preset.name}
            </button>
          ))}
        </div>
        <Field label="账户名称">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：美股科技波段账户"
            className="w-full rounded-lg border border-line bg-void/70 px-2.5 py-2 text-[13px] text-ink outline-none focus:border-gold/55"
          />
        </Field>
        <Field label="账本货币">
          <div className="flex gap-1.5">
            {(['USD', 'MYR'] as Currency[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCurrency(c)}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 font-mono text-[11.5px] transition',
                  currency === c ? 'border-gold/50 bg-gold/12 text-gold' : 'border-line bg-panel-2 text-dim hover:text-ink',
                )}
              >
                {CURRENCY_LABEL[c]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="初始本金">
          <input
            value={capital}
            onChange={(e) => setCapital(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            className="w-full rounded-lg border border-line bg-void/70 px-2.5 py-2 font-mono text-[13px] text-ink outline-none focus:border-gold/55"
          />
        </Field>
      </div>
    </Modal>
  )
}

function RenameModal({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean
  initial: string
  onClose: () => void
  onSubmit: (name: string) => void
}) {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    if (open) setValue(initial)
  }, [open, initial])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="重命名账户"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-line-2 px-3 py-1.5 font-mono text-[11px] text-dim transition hover:text-ink">
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              onSubmit(value)
              onClose()
            }}
            className="rounded-lg border border-gold/50 bg-gold/15 px-3 py-1.5 font-mono text-[11px] text-gold transition hover:bg-gold/25"
          >
            保存
          </button>
        </div>
      }
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-lg border border-line bg-void/70 px-2.5 py-2 text-[13px] text-ink outline-none focus:border-gold/55"
      />
    </Modal>
  )
}

function FundModal({
  open,
  profile,
  onClose,
  onResetCapital,
  onDeposit,
  onSetFxRate,
}: {
  open: boolean
  profile: PaperProfile
  onClose: () => void
  onResetCapital: (amount: number) => void
  onDeposit: (amount: number) => void
  onSetFxRate: (rate: number) => void
}) {
  const [capital, setCapital] = useState(String(profile.initialCapital))
  const [addFund, setAddFund] = useState('10000')
  const [fx, setFx] = useState(String(profile.fxRate))
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setCapital(String(profile.initialCapital))
      setAddFund('10000')
      setFx(String(profile.fxRate))
      setNotice(null)
    }
  }, [open, profile])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`资金管理 · ${profile.name}`}
      subtitle="可随时重置初始本金、追加资金，或调整 USD/MYR 汇率。"
      size="sm"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-void/40 p-3">
          <div className="flex items-center gap-1.5">
            <Wallet className="size-3.5 text-gold" />
            <span className="font-mono text-[10.5px] tracking-[0.12em] text-gold uppercase">追加资金</span>
          </div>
          <p className="mt-1 text-[11px] text-faint">在保留现有持仓与流水的前提下增加可用现金与本金。</p>
          <div className="mt-2 flex gap-2">
            <input
              value={addFund}
              onChange={(e) => setAddFund(e.target.value.replace(/[^0-9.-]/g, ''))}
              inputMode="decimal"
              className="min-w-0 flex-1 rounded-lg border border-line bg-void/70 px-2.5 py-2 font-mono text-[13px] text-ink outline-none focus:border-gold/55"
            />
            <button
              type="button"
              onClick={() => {
                const amount = Number(addFund)
                if (!Number.isFinite(amount) || amount === 0) return
                onDeposit(amount)
                setNotice(`已追加资金 ${formatPrice(amount, profile.currency)}`)
              }}
              className="rounded-lg border border-gold/50 bg-gold/15 px-3 py-2 font-mono text-[11px] text-gold transition hover:bg-gold/25"
            >
              追加
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-bear/25 bg-bear/[0.05] p-3">
          <span className="font-mono text-[10.5px] tracking-[0.12em] text-bear uppercase">重置初始本金</span>
          <p className="mt-1 text-[11px] text-faint">将清空全部持仓、挂单与交易流水，本金与现金重置为指定金额。</p>
          <div className="mt-2 flex gap-2">
            <input
              value={capital}
              onChange={(e) => setCapital(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              className="min-w-0 flex-1 rounded-lg border border-line bg-void/70 px-2.5 py-2 font-mono text-[13px] text-ink outline-none focus:border-gold/55"
            />
            <button
              type="button"
              onClick={() => {
                const amount = Number(capital)
                if (!Number.isFinite(amount) || amount <= 0) return
                onResetCapital(amount)
                setNotice(`账户已重置，初始本金 ${formatPrice(amount, profile.currency)}`)
              }}
              className="rounded-lg border border-bear/45 bg-bear/10 px-3 py-2 font-mono text-[11px] text-bear transition hover:bg-bear/20"
            >
              重置
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-void/40 p-3">
          <span className="font-mono text-[10.5px] tracking-[0.12em] text-ice uppercase">USD / MYR 汇率</span>
          <p className="mt-1 text-[11px] text-faint">用于跨市场持仓折算（1 USD 兑多少 MYR）。</p>
          <div className="mt-2 flex gap-2">
            <input
              value={fx}
              onChange={(e) => setFx(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              className="min-w-0 flex-1 rounded-lg border border-line bg-void/70 px-2.5 py-2 font-mono text-[13px] text-ink outline-none focus:border-gold/55"
            />
            <button
              type="button"
              onClick={() => {
                const rate = Number(fx)
                if (!Number.isFinite(rate) || rate <= 0) return
                onSetFxRate(rate)
                setNotice(`汇率已更新为 1 USD = ${rate} MYR`)
              }}
              className="rounded-lg border border-ice/45 bg-ice/10 px-3 py-2 font-mono text-[11px] text-ice transition hover:bg-ice/20"
            >
              更新
            </button>
          </div>
        </div>

        {notice && <p className="font-mono text-[11px] text-bull">{notice}</p>}
      </div>
    </Modal>
  )
}

function ConfirmModal({
  open,
  title,
  message,
  onClose,
  onConfirm,
}: {
  open: boolean
  title: string
  message: string
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-line-2 px-3 py-1.5 font-mono text-[11px] text-dim transition hover:text-ink">
            取消
          </button>
          <button type="button" onClick={onConfirm} className="rounded-lg border border-bear/50 bg-bear/15 px-3 py-1.5 font-mono text-[11px] text-bear transition hover:bg-bear/25">
            确认删除
          </button>
        </div>
      }
    >
      <p className="text-[12.5px] leading-relaxed text-dim">{message}</p>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10.5px] tracking-[0.1em] text-faint uppercase">{label}</span>
      {children}
    </label>
  )
}
