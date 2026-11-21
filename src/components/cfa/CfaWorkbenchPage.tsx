import { useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  FileText,
  Flame,
  GraduationCap,
  HelpCircle,
  Infinity as InfinityIcon,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  PlayCircle,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'

import type { ApiSettings, CfaQuestion, CfaTopicId, CfaUnitStatus, RelayMeta } from '@/types'
import { useCfaWorkbench, type CfaSubView } from '@/hooks/useCfaWorkbench'
import { formatRelayBadge, hasAnyAiConfigured } from '@/lib/aiFallback'
import {
  askUnitFollowup,
  generateInfiniteDrillQuestion,
  generateUnitCheckpointQuiz,
  generateUnitLecture,
} from '@/lib/cfaAi'
import {
  CFA_TOPICS,
  extractTextFromPdf,
  splitHandbookTextRuleBased,
  topicMeta,
} from '@/lib/cfaPdf'
import { cn } from '@/lib/cn'

interface CfaWorkbenchPageProps {
  settings: ApiSettings
  onOpenSettings: () => void
}

const STATUS_META: Record<CfaUnitStatus, { label: string; dot: string; text: string }> = {
  not_started: { label: '未开始', dot: 'bg-faint', text: 'text-faint' },
  in_progress: { label: '学习中', dot: 'bg-gold', text: 'text-gold' },
  completed: { label: '已完成', dot: 'bg-bull', text: 'text-bull' },
}

export function CfaWorkbenchPage({ settings, onOpenSettings }: CfaWorkbenchPageProps) {
  const wb = useCfaWorkbench()
  const aiReady = hasAnyAiConfigured(settings)

  const [subView, setLocalSubView] = useState<CfaSubView>(wb.lastSubView || 'study')
  const [confirmDeleteUnitId, setConfirmDeleteUnitId] = useState<string | null>(null)
  const [showRawText, setShowRawText] = useState(false)

  // Lecture & Q&A state
  const [lectureLoading, setLectureLoading] = useState(false)
  const [lectureError, setLectureError] = useState<string | null>(null)
  const [qaInput, setQaInput] = useState('')
  const [qaLoading, setQaLoading] = useState(false)
  const [qaError, setQaError] = useState<string | null>(null)

  // Unit quiz state
  const [quizLoading, setQuizLoading] = useState(false)
  const [quizError, setQuizError] = useState<string | null>(null)

  // Infinite drill state
  const [drillLoading, setDrillLoading] = useState(false)
  const [drillError, setDrillError] = useState<string | null>(null)
  const [drillQuestion, setDrillQuestion] = useState<CfaQuestion | null>(null)
  const [drillRelay, setDrillRelay] = useState<RelayMeta | null>(null)
  const [drillChoice, setDrillChoice] = useState<'A' | 'B' | 'C' | null>(null)
  const [drillHistoryStems, setDrillHistoryStems] = useState<string[]>([])
  const [drillStats, setDrillStats] = useState<{ total: number; correct: number }>({
    total: 0,
    correct: 0,
  })

  // Mistake book state
  const [mistakeFilter, setMistakeFilter] = useState<'all' | 'unmastered' | 'mastered'>('unmastered')
  const [mistakeTopic, setMistakeTopic] = useState<CfaTopicId | 'all'>('all')
  const [mistakeRetryChoice, setMistakeRetryChoice] = useState<Record<string, 'A' | 'B' | 'C'>>({})
  const [mistakeExpanded, setMistakeExpanded] = useState<Record<string, boolean>>({})

  // Handbook import state
  const [importTopic, setImportTopic] = useState<CfaTopicId>('quant')
  const [importTitle, setImportTitle] = useState('')
  const [importSourceName, setImportSourceName] = useState('')
  const [importText, setImportText] = useState('')
  const [pdfProgress, setPdfProgress] = useState<string | null>(null)
  const [importFeedback, setImportFeedback] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentUnit = wb.currentUnit
  const currentLecture = currentUnit ? wb.lectures[currentUnit.id] : undefined
  const currentQa = currentUnit ? wb.qaByUnit[currentUnit.id] ?? [] : []
  const currentQuiz = currentUnit ? wb.quizzesByUnit[currentUnit.id] : undefined

  const unmasteredMistakes = useMemo(
    () => wb.mistakes.filter((m) => !m.mastered).length,
    [wb.mistakes],
  )

  const switchSubView = (next: CfaSubView) => {
    setLocalSubView(next)
    wb.setSubView(next)
  }

  const handleSelectUnit = (unitId: string, targetView: CfaSubView = 'study') => {
    setShowRawText(false)
    setLectureError(null)
    setQaError(null)
    setQuizError(null)
    wb.selectUnit(unitId, targetView)
    setLocalSubView(targetView)
  }

  const handleResumeLastStudy = () => {
    if (!currentUnit) {
      switchSubView('import')
      return
    }
    const target: CfaSubView = subView === 'quiz' || subView === 'study' ? subView : 'study'
    handleSelectUnit(currentUnit.id, target)
  }

  const handleGenerateLecture = async () => {
    if (!currentUnit) return
    if (!aiReady) {
      onOpenSettings()
      return
    }
    setLectureLoading(true)
    setLectureError(null)
    try {
      const note = await generateUnitLecture(currentUnit, settings)
      wb.saveLecture(note)
    } catch (err) {
      setLectureError(err instanceof Error ? err.message : String(err))
    } finally {
      setLectureLoading(false)
    }
  }

  const handleSendQa = async () => {
    if (!currentUnit) return
    const q = qaInput.trim()
    if (!q || qaLoading) return
    if (!aiReady) {
      onOpenSettings()
      return
    }

    const userMsg = {
      id: `qa-u-${Date.now().toString(36)}`,
      role: 'user' as const,
      content: q,
      createdAt: new Date().toISOString(),
    }
    wb.appendQaMessage(currentUnit.id, userMsg)
    setQaInput('')
    setQaLoading(true)
    setQaError(null)

    try {
      const res = await askUnitFollowup(currentUnit, q, currentQa, settings)
      wb.appendQaMessage(currentUnit.id, {
        id: `qa-a-${Date.now().toString(36)}`,
        role: 'assistant',
        content: res.answer,
        createdAt: new Date().toISOString(),
        relay: res.relay,
      })
    } catch (err) {
      setQaError(err instanceof Error ? err.message : String(err))
    } finally {
      setQaLoading(false)
    }
  }

  const handleGenerateUnitQuiz = async (forceNew = false) => {
    if (!currentUnit) return
    if (!forceNew && currentQuiz) {
      switchSubView('quiz')
      return
    }
    if (!aiReady) {
      onOpenSettings()
      return
    }
    switchSubView('quiz')
    setQuizLoading(true)
    setQuizError(null)
    try {
      const res = await generateUnitCheckpointQuiz(currentUnit, settings)
      wb.saveQuizAttempt({
        unitId: currentUnit.id,
        questions: res.questions,
        answers: {},
        submitted: false,
        score: 0,
        total: res.questions.length,
        passed: false,
        relay: res.relay,
        createdAt: new Date().toISOString(),
      })
    } catch (err) {
      setQuizError(err instanceof Error ? err.message : String(err))
    } finally {
      setQuizLoading(false)
    }
  }

  const handleNextDrillQuestion = async () => {
    if (wb.completedUnits.length === 0) {
      setDrillError('请先至少通过 1 个章节（Unit）的过关测验或标为「已完成」，再开始无限刷题。')
      return
    }
    if (!aiReady) {
      onOpenSettings()
      return
    }
    setDrillLoading(true)
    setDrillError(null)
    setDrillChoice(null)
    try {
      const res = await generateInfiniteDrillQuestion(
        wb.completedUnits,
        drillHistoryStems,
        settings,
      )
      setDrillQuestion(res.question)
      setDrillRelay(res.relay)
      setDrillHistoryStems((prev) => [...prev.slice(-15), res.question.stem])
    } catch (err) {
      setDrillError(err instanceof Error ? err.message : String(err))
    } finally {
      setDrillLoading(false)
    }
  }

  const handleSelectDrillChoice = (choice: 'A' | 'B' | 'C') => {
    if (!drillQuestion || drillChoice !== null) return
    setDrillChoice(choice)
    const isCorrect = choice === drillQuestion.answer
    setDrillStats((prev) => ({
      total: prev.total + 1,
      correct: prev.correct + (isCorrect ? 1 : 0),
    }))
    if (!isCorrect) {
      wb.addMistakes([
        {
          question: drillQuestion,
          userChoice: choice,
          source: 'infinite_drill',
        },
      ])
    }
  }

  const handleUploadFile = async (file: File | undefined) => {
    if (!file) return
    setImportFeedback(null)
    const name = file.name || 'handbook'
    setImportSourceName(name)

    if (file.type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
      try {
        setPdfProgress('正在初始化 PDF 解析器…')
        const { text, pages } = await extractTextFromPdf(file, (p, total) => {
          setPdfProgress(`正在本地解析 PDF 第 ${p} / ${total} 页…`)
        })
        setPdfProgress(null)
        if (!text.trim()) {
          setImportFeedback('未从该 PDF 中提取到可复制文本（可能为纯扫描图片 PDF），请粘贴原文文本后导入。')
          return
        }
        setImportText(text)
        setImportFeedback(`已提取 ${pages} 页文本（约 ${text.length.toLocaleString()} 字），确认无误后点击「解析并导入章节」。`)
      } catch (err) {
        setPdfProgress(null)
        setImportFeedback(`PDF 解析失败：${err instanceof Error ? err.message : String(err)}`)
      }
      return
    }

    try {
      const text = await file.text()
      setImportText(text)
      setImportFeedback(`已读取文件「${name}」（约 ${text.length.toLocaleString()} 字），确认后点击导入。`)
    } catch (err) {
      setImportFeedback(`文件读取失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleConfirmImport = () => {
    setImportFeedback(null)
    const raw = importText.trim()
    if (!raw) {
      setImportFeedback('请先上传 2027 Handbook PDF 或粘贴章节原文文本。')
      return
    }
    const startOrder = wb.nextOrderForTopic(importTopic)
    const units = splitHandbookTextRuleBased(
      raw,
      importTopic,
      importSourceName || '2027 Handbook 手动导入',
      startOrder,
      importTitle,
    )
    if (units.length === 0) {
      setImportFeedback('未能识别出有效文本内容，请检查输入后重试。')
      return
    }
    wb.importUnits(units)
    setImportTitle('')
    setImportText('')
    setImportSourceName('')
    setLocalSubView('study')
    setShowRawText(false)
  }

  const groupedUnits = useMemo(() => {
    const map = new Map<CfaTopicId, typeof wb.units>()
    for (const u of wb.units) {
      const arr = map.get(u.topicId) ?? []
      arr.push(u)
      map.set(u.topicId, arr)
    }
    return CFA_TOPICS.map((topic) => ({
      topic,
      units: map.get(topic.id) ?? [],
    })).filter((g) => g.units.length > 0)
  }, [wb.units])

  const filteredMistakes = useMemo(() => {
    return wb.mistakes.filter((m) => {
      if (mistakeFilter === 'unmastered' && m.mastered) return false
      if (mistakeFilter === 'mastered' && !m.mastered) return false
      if (mistakeTopic !== 'all' && m.topicId !== mistakeTopic) return false
      return true
    })
  }, [wb.mistakes, mistakeFilter, mistakeTopic])

  const currentTopicMeta = currentUnit ? topicMeta(currentUnit.topicId) : null

  return (
    <main className="mx-auto flex w-full max-w-[1720px] flex-1 flex-col gap-4 px-3 py-4 sm:px-5">
      {/* 顶部【继续上次学习】断点卡片 */}
      <section className="panel relative overflow-hidden p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] tracking-[0.12em] text-gold uppercase">
              <GraduationCap className="size-3.5" />
              <span>CFA Level 1 · 2027 考纲备考工作台</span>
              <span className="text-faint">·</span>
              <span className="tabular-nums text-dim">
                已通关 {wb.completedUnits.length} / {wb.units.length} 节
              </span>
              <span className="text-faint">·</span>
              <span className="tabular-nums text-bear">待复习错题 {unmasteredMistakes} 道</span>
            </div>

            {currentUnit && currentTopicMeta ? (
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <h1 className="font-mono text-[15px] font-semibold text-ink">
                  继续上次学习：{currentUnit.code} · {currentUnit.title}
                </h1>
                <span className="font-mono text-[11px] text-dim">
                  {currentTopicMeta.nameZh} ({currentTopicMeta.nameEn}) ·{' '}
                  <span className={STATUS_META[currentUnit.status].text}>
                    {STATUS_META[currentUnit.status].label}
                  </span>
                </span>
              </div>
            ) : (
              <div className="font-mono text-[14px] font-semibold text-ink">
                尚未导入 2027 Handbook 章节，请点击右侧导入 PDF 或文本原文开始学习
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!aiReady && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gold/50 bg-gold/12 px-3 py-1.5 font-mono text-[11px] text-gold transition hover:bg-gold/20"
              >
                <KeyRound className="size-3.5" />
                先配置 AI 接力密钥
              </button>
            )}
            <button
              type="button"
              onClick={handleResumeLastStudy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gold/55 bg-gold/15 px-3.5 py-2 font-mono text-[11.5px] font-semibold text-gold transition hover:bg-gold/25"
            >
              <PlayCircle className="size-4" />
              <span>{currentUnit ? '继续上次学习' : '导入 2027 Handbook'}</span>
            </button>
          </div>
        </div>

        {/* 二级子标签切换 */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line/70 pt-3">
          {(
            [
              { key: 'study', label: '跟课精讲与目录', icon: BookOpen },
              { key: 'quiz', label: '单元过关测验', icon: ClipboardCheck },
              {
                key: 'drill',
                label: `无限刷题模式 (${wb.completedUnits.length > 0 ? `已解锁 ${wb.completedUnits.length} 节` : '需先通关 1 节'})`,
                icon: InfinityIcon,
              },
              { key: 'mistakes', label: `错题本 (${unmasteredMistakes})`, icon: Flame },
              { key: 'import', label: '导入 2027 Handbook', icon: Upload },
            ] as Array<{ key: CfaSubView; label: string; icon: typeof BookOpen }>
          ).map((tab) => {
            const Icon = tab.icon
            const active = subView === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => switchSubView(tab.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11.5px] transition',
                  active
                    ? 'border-gold/50 bg-gold/12 text-gold'
                    : 'border-line bg-void/45 text-dim hover:border-line-2 hover:text-ink',
                )}
              >
                <Icon className="size-3.5" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* 主体内容区 */}
      {(subView === 'study' || subView === 'quiz') && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* 左侧：Topic -> Unit 结构化目录 */}
          <aside className="panel flex flex-col p-3.5 lg:col-span-4 xl:col-span-3">
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <div>
                <h2 className="font-mono text-[12px] font-semibold text-ink">
                  2027 考纲章节目录
                </h2>
                <p className="mt-0.5 font-mono text-[10px] text-faint">
                  Topic → Learning Module（点击切换断点）
                </p>
              </div>
              <button
                type="button"
                onClick={() => switchSubView('import')}
                className="inline-flex items-center gap-1 rounded-md border border-line-2 px-2 py-1 font-mono text-[10px] text-dim transition hover:border-gold/50 hover:text-gold"
              >
                <Plus className="size-3" />
                导入
              </button>
            </div>

            <div className="mt-3 max-h-[68vh] space-y-3 overflow-y-auto pr-1">
              {groupedUnits.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line-2 p-4 text-center text-[11.5px] text-faint">
                  暂无章节，请先点击右上角「导入」添加 2027 Handbook 原文。
                </div>
              ) : (
                groupedUnits.map(({ topic, units }) => (
                  <div key={topic.id} className="space-y-1.5">
                    <div className="flex items-center justify-between font-mono text-[10.5px] text-dim">
                      <span className="font-semibold text-ice">
                        {topic.code} · {topic.nameZh}
                      </span>
                      <span className="tabular-nums text-[9.5px] text-faint">
                        考纲权重 {topic.weight2027}
                      </span>
                    </div>

                    <div className="space-y-1">
                      {units.map((unit) => {
                        const selected = currentUnit?.id === unit.id
                        const st = STATUS_META[unit.status]
                        const deleting = confirmDeleteUnitId === unit.id
                        return (
                          <div
                            key={unit.id}
                            className={cn(
                              'group flex items-start justify-between gap-2 rounded-lg border px-2.5 py-2 transition',
                              selected
                                ? 'border-gold/50 bg-gold/10'
                                : 'border-line bg-void/40 hover:border-line-2',
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => handleSelectUnit(unit.id, subView)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className={cn('size-2 shrink-0 rounded-full', st.dot)} />
                                <span className="font-mono text-[10.5px] font-semibold text-ink">
                                  {unit.code}
                                </span>
                                <span className={cn('font-mono text-[9.5px]', st.text)}>
                                  {st.label}
                                </span>
                                {typeof unit.lastQuizScore === 'number' &&
                                  typeof unit.lastQuizTotal === 'number' && (
                                    <span className="ml-auto font-mono text-[9.5px] tabular-nums text-dim">
                                      测验 {unit.lastQuizScore}/{unit.lastQuizTotal}
                                    </span>
                                  )}
                              </div>
                              <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-dim">
                                {unit.title}
                              </div>
                            </button>

                            {deleting ? (
                              <div className="flex shrink-0 flex-col gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    wb.deleteUnit(unit.id)
                                    setConfirmDeleteUnitId(null)
                                  }}
                                  className="rounded border border-bear/50 bg-bear/15 px-1.5 py-0.5 font-mono text-[9.5px] text-bear"
                                >
                                  确认删
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteUnitId(null)}
                                  className="rounded border border-line px-1.5 py-0.5 font-mono text-[9.5px] text-faint"
                                >
                                  取消
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteUnitId(unit.id)}
                                title="删除此章节"
                                className="shrink-0 rounded p-1 text-faint opacity-60 transition hover:text-bear group-hover:opacity-100"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          {/* 右侧：跟课精讲 OR 单元过关测验 */}
          <section className="space-y-4 lg:col-span-8 xl:col-span-9">
            {!currentUnit ? (
              <div className="panel p-8 text-center">
                <FileText className="mx-auto size-8 text-faint" />
                <p className="mt-2 font-mono text-[13px] text-dim">
                  请从左侧选择或导入一个 2027 Learning Module
                </p>
                <button
                  type="button"
                  onClick={() => switchSubView('import')}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gold/50 bg-gold/15 px-4 py-2 font-mono text-[11.5px] text-gold"
                >
                  <Upload className="size-3.5" />
                  导入 2027 Handbook
                </button>
              </div>
            ) : subView === 'study' ? (
              <>
                {/* 章节头与操作栏 */}
                <div className="panel p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="font-mono text-[10.5px] text-ice">
                        {currentTopicMeta?.nameZh} · {currentTopicMeta?.nameEn} · 来源：{currentUnit.sourceName}
                      </div>
                      <h2 className="text-[17px] font-semibold text-ink">
                        {currentUnit.code} — {currentUnit.title}
                      </h2>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          wb.setUnitStatus(
                            currentUnit.id,
                            currentUnit.status === 'completed' ? 'in_progress' : 'completed',
                          )
                        }
                        className={cn(
                          'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] transition',
                          currentUnit.status === 'completed'
                            ? 'border-bull/50 bg-bull/12 text-bull'
                            : 'border-line-2 text-dim hover:border-bull/45 hover:text-bull',
                        )}
                      >
                        <CheckCircle2 className="size-3.5" />
                        {currentUnit.status === 'completed' ? '已标为完成' : '手动标为完成'}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleGenerateLecture()}
                        disabled={lectureLoading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gold/55 bg-gold/15 px-3 py-1.5 font-mono text-[11px] font-medium text-gold transition hover:bg-gold/25 disabled:opacity-50"
                      >
                        {lectureLoading ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="size-3.5" />
                        )}
                        {currentLecture ? '重新生成跟课精讲' : '生成跟课式精讲'}
                      </button>
                    </div>
                  </div>

                  {/* 折叠原文预览 */}
                  <div className="mt-3 border-t border-line/70 pt-2.5">
                    <button
                      type="button"
                      onClick={() => setShowRawText((s) => !s)}
                      className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-dim hover:text-ink"
                    >
                      {showRawText ? (
                        <ChevronUp className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                      {showRawText
                        ? '收起已导入 2027 Handbook 原文'
                        : `查看已导入 2027 Handbook 原文（共 ${currentUnit.rawText.length.toLocaleString()} 字）`}
                    </button>

                    {showRawText && (
                      <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-void/70 p-3 font-mono text-[11px] leading-relaxed text-dim">
                        {currentUnit.rawText}
                      </pre>
                    )}
                  </div>
                </div>

                {lectureError && (
                  <div className="flex items-start gap-2 rounded-xl border border-bear/45 bg-bear/10 px-3.5 py-2.5 text-[12px] text-bear">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{lectureError}</span>
                  </div>
                )}

                {/* 跟课讲义主体 */}
                {currentLecture ? (
                  <div className="panel space-y-5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
                      <h3 className="font-mono text-[12.5px] font-semibold text-gold">
                        2027 Handbook 跟课精讲笔记
                      </h3>
                      <span className="font-mono text-[10.5px] text-dim">
                        {formatRelayBadge(currentLecture.relay)}
                      </span>
                    </div>

                    {/* 1. 核心概念白话拆解 */}
                    <div className="space-y-2.5">
                      <h4 className="font-mono text-[11.5px] font-semibold tracking-[0.06em] text-ice uppercase">
                        一、核心概念白话拆解（中英双语金融术语）
                      </h4>
                      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        {currentLecture.coreConcepts.map((item, idx) => (
                          <div
                            key={`${item.termEn}-${idx}`}
                            className="rounded-lg border border-line bg-panel-2/60 p-3 space-y-1.5"
                          >
                            <div className="font-mono text-[12px] font-semibold text-ink">
                              {item.termZh}{' '}
                              <span className="font-normal text-gold">({item.termEn})</span>
                            </div>
                            <p className="text-[12px] leading-relaxed text-dim">
                              {item.plainExplanation}
                            </p>
                            {item.example && (
                              <div className="rounded border border-line/80 bg-void/55 px-2.5 py-1.5 text-[11px] text-faint">
                                <span className="font-mono text-bull">案例：</span>
                                {item.example}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 2. 必背公式与 BA II Plus 计算器按键逻辑 */}
                    {currentLecture.formulasAndCalculator.length > 0 && (
                      <div className="space-y-2.5">
                        <h4 className="flex items-center gap-1.5 font-mono text-[11.5px] font-semibold tracking-[0.06em] text-gold uppercase">
                          <Calculator className="size-3.5" />
                          二、必背公式与 BA II Plus 财务计算器按键逻辑
                        </h4>
                        <div className="space-y-2.5">
                          {currentLecture.formulasAndCalculator.map((f, idx) => (
                            <div
                              key={`${f.name}-${idx}`}
                              className="rounded-lg border border-line bg-panel-2/60 p-3 space-y-2"
                            >
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <span className="font-mono text-[12px] font-semibold text-ink">
                                  {f.name}
                                </span>
                                <code className="rounded bg-void px-2 py-0.5 font-mono text-[11.5px] text-gold">
                                  {f.formula}
                                </code>
                              </div>
                              {f.variables && (
                                <p className="text-[11px] leading-relaxed text-dim">
                                  <span className="font-mono text-faint">变量约定：</span>
                                  {f.variables}
                                </p>
                              )}
                              {f.ba2PlusSteps && (
                                <div className="rounded-md border border-ice/30 bg-ice/[0.05] px-2.5 py-1.5 font-mono text-[11px] text-ice">
                                  BA II Plus：{f.ba2PlusSteps}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 3. 2027 考纲高频考点与避坑 */}
                    {currentLecture.examFocus2027.length > 0 && (
                      <div className="space-y-2.5">
                        <h4 className="font-mono text-[11.5px] font-semibold tracking-[0.06em] text-bull uppercase">
                          三、2027 考纲高频考点与考场避坑
                        </h4>
                        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                          {currentLecture.examFocus2027.map((ex, idx) => (
                            <div
                              key={idx}
                              className="rounded-lg border border-line bg-void/50 p-3 space-y-1"
                            >
                              <div className="text-[12px] font-medium text-ink">
                                {idx + 1}. {ex.point}
                              </div>
                              {ex.trap && (
                                <div className="text-[11px] text-bear">
                                  陷阱提示：{ex.trap}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 4. 通关总结 */}
                    {currentLecture.summaryTakeaway && (
                      <div className="rounded-lg border border-gold/30 bg-gold/[0.06] px-3.5 py-2.5 text-[12px] leading-relaxed text-ink">
                        <span className="font-mono font-semibold text-gold">本节通关精华：</span>
                        {currentLecture.summaryTakeaway}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="panel flex flex-col items-center justify-center gap-3 p-8 text-center">
                    <BookOpen className="size-8 text-gold/75" />
                    <div className="space-y-1">
                      <h3 className="font-mono text-[13px] font-semibold text-ink">
                        准备就绪：跟着 2027 Handbook 原文生成本节跟课精讲
                      </h3>
                      <p className="max-w-xl text-[11.5px] text-dim">
                        将严格基于当前 Learning Module 原文拆解双语概念、必背公式、TI BA II Plus 按键顺序与 2027 考纲命题陷阱。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleGenerateLecture()}
                      disabled={lectureLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gold/55 bg-gold/15 px-4 py-2 font-mono text-[11.5px] font-semibold text-gold transition hover:bg-gold/25 disabled:opacity-50"
                    >
                      {lectureLoading ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Sparkles className="size-4" />
                      )}
                      立即生成本节跟课精讲
                    </button>
                  </div>
                )}

                {/* 底部随堂互动答疑 */}
                <div className="panel space-y-3 p-4">
                  <div className="flex items-center justify-between border-b border-line pb-2">
                    <div className="flex items-center gap-2 font-mono text-[12px] font-semibold text-ink">
                      <MessageSquare className="size-3.5 text-ice" />
                      <span>跟课答疑台（严格围绕本节原文）</span>
                    </div>
                    {currentQa.length > 0 && (
                      <button
                        type="button"
                        onClick={() => wb.clearQa(currentUnit.id)}
                        className="font-mono text-[10px] text-faint hover:text-bear"
                      >
                        清空对话
                      </button>
                    )}
                  </div>

                  {currentQa.length > 0 && (
                    <div className="max-h-80 space-y-2.5 overflow-y-auto pr-1">
                      {currentQa.map((msg) => (
                        <div
                          key={msg.id}
                          className={cn(
                            'rounded-lg border p-3 text-[12px] leading-relaxed',
                            msg.role === 'user'
                              ? 'border-gold/30 bg-gold/[0.05] text-ink'
                              : 'border-line bg-panel-2/70 text-dim',
                          )}
                        >
                          <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-faint">
                            <span>{msg.role === 'user' ? '我的提问' : 'CFA 跟课导师'}</span>
                            {msg.role === 'assistant' && msg.relay && (
                              <span className="text-dim">{formatRelayBadge(msg.relay)}</span>
                            )}
                          </div>
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {qaError && (
                    <div className="font-mono text-[11px] text-bear">答疑失败：{qaError}</div>
                  )}

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={qaInput}
                      onChange={(e) => setQaInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void handleSendQa()
                        }
                      }}
                      placeholder="例如：Annuity Due 用 BA II Plus 切 BGN 模式后要注意什么？TWRR 与 MWRR 考试怎么区分？"
                      className="flex-1 rounded-lg border border-line bg-void/70 px-3 py-2 text-[12px] text-ink placeholder:text-faint/65 focus:border-gold/55"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSendQa()}
                      disabled={qaLoading || !qaInput.trim()}
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-ice/50 bg-ice/15 px-3.5 py-2 font-mono text-[11px] font-medium text-ice transition hover:bg-ice/25 disabled:opacity-45"
                    >
                      {qaLoading ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Send className="size-3.5" />
                      )}
                      提问导师
                    </button>
                  </div>
                </div>

                {/* 章节底端主 CTA：【完成本节并做过关测验】 */}
                <div className="panel flex flex-col items-start justify-between gap-3 border-bull/35 bg-bull/[0.04] p-4 sm:flex-row sm:items-center">
                  <div>
                    <div className="font-mono text-[12.5px] font-semibold text-bull">
                      学完本节？立刻检验掌握度并解锁无限刷题范围
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-dim">
                      点击生成 5 道 CFA L1 标准三选一过关测验（≥ 3 题自动通过并计入已完成单元）。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleGenerateUnitQuiz(false)}
                    disabled={quizLoading}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-bull/60 bg-bull/20 px-4 py-2 font-mono text-[12px] font-semibold text-bull transition hover:bg-bull/30 disabled:opacity-50"
                  >
                    <ClipboardCheck className="size-4" />
                    <span>完成本节并做过关测验</span>
                    <ArrowRight className="size-3.5" />
                  </button>
                </div>
              </>
            ) : (
              /* 单元过关测验 Pane */
              <div className="panel space-y-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                  <div>
                    <div className="font-mono text-[10.5px] text-gold">
                      单元过关测验 · {currentUnit.code} — {currentUnit.title}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-dim">
                      <span>标准 CFA L1 三选一（A/B/C）· 共 5 题 · 答对 ≥ 3 题过关</span>
                      {currentQuiz?.relay && (
                        <>
                          <span className="text-faint">·</span>
                          <span>{formatRelayBadge(currentQuiz.relay)}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => switchSubView('study')}
                      className="rounded-lg border border-line-2 px-3 py-1.5 font-mono text-[11px] text-dim hover:text-ink"
                    >
                      返回跟课精讲
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleGenerateUnitQuiz(true)}
                      disabled={quizLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gold/50 bg-gold/12 px-3 py-1.5 font-mono text-[11px] text-gold transition hover:bg-gold/20 disabled:opacity-50"
                    >
                      {quizLoading ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="size-3.5" />
                      )}
                      {currentQuiz ? '重新出 5 题' : '生成 5 道过关题'}
                    </button>
                  </div>
                </div>

                {quizError && (
                  <div className="flex items-start gap-2 rounded-lg border border-bear/45 bg-bear/10 px-3 py-2.5 text-[12px] text-bear">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{quizError}</span>
                  </div>
                )}

                {quizLoading ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 font-mono text-[12px] text-dim">
                    <LoaderCircle className="size-6 animate-spin text-gold" />
                    <span>正在依据 {currentUnit.code} 原文命制 5 道过关测验题…</span>
                  </div>
                ) : !currentQuiz ? (
                  <div className="py-10 text-center space-y-3">
                    <HelpCircle className="mx-auto size-8 text-faint" />
                    <p className="text-[12px] text-dim">
                      本节尚未生成过关测验，点击上方「生成 5 道过关题」即可开始自测。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {currentQuiz.submitted && (
                      <div
                        className={cn(
                          'flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5',
                          currentQuiz.passed
                            ? 'border-bull/50 bg-bull/10 text-bull'
                            : 'border-bear/45 bg-bear/10 text-bear',
                        )}
                      >
                        <div className="font-mono text-[13px] font-semibold tabular-nums">
                          测验得分：{currentQuiz.score} / {currentQuiz.total}{' '}
                          {currentQuiz.passed
                            ? '· 恭喜过关！本节已标记为「已完成」并解锁至无限刷题池'
                            : '· 未达 60% 及格线，错题已自动收入错题本，建议重读精讲后再测'}
                        </div>
                        {currentQuiz.passed && (
                          <button
                            type="button"
                            onClick={() => switchSubView('drill')}
                            className="inline-flex items-center gap-1 rounded-lg border border-bull/60 bg-bull/20 px-3 py-1 font-mono text-[11px] text-bull"
                          >
                            <InfinityIcon className="size-3.5" />
                            去无限刷题
                          </button>
                        )}
                      </div>
                    )}

                    {currentQuiz.questions.map((q, idx) => {
                      const chosen = currentQuiz.answers[q.id]
                      const submitted = currentQuiz.submitted
                      const isRight = submitted && chosen === q.answer
                      return (
                        <div
                          key={q.id}
                          className="rounded-xl border border-line bg-panel-2/55 p-3.5 space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-mono text-[11px] text-gold">
                              第 {idx + 1} 题 ·{' '}
                              <span className="text-dim">
                                {q.kind === 'calculation' ? '计算实务题' : '概念辨析题'}
                              </span>
                            </div>
                            {submitted && (
                              <span
                                className={cn(
                                  'font-mono text-[11px] font-semibold',
                                  isRight ? 'text-bull' : 'text-bear',
                                )}
                              >
                                {isRight ? '回答正确 ✓' : `答错 · 正解 ${q.answer}`}
                              </span>
                            )}
                          </div>

                          <p className="text-[13px] leading-relaxed text-ink">{q.stem}</p>

                          <div className="space-y-1.5">
                            {(['A', 'B', 'C'] as const).map((opt) => {
                              const picked = chosen === opt
                              const isCorrectOpt = submitted && q.answer === opt
                              const isWrongPicked = submitted && picked && q.answer !== opt
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  disabled={submitted}
                                  onClick={() => wb.updateQuizAnswer(currentUnit.id, q.id, opt)}
                                  className={cn(
                                    'flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-[12px] transition',
                                    isCorrectOpt
                                      ? 'border-bull/60 bg-bull/12 text-bull'
                                      : isWrongPicked
                                        ? 'border-bear/60 bg-bear/12 text-bear'
                                        : picked
                                          ? 'border-gold/60 bg-gold/12 text-gold'
                                          : 'border-line bg-void/45 text-dim hover:border-line-2 hover:text-ink',
                                  )}
                                >
                                  <span className="font-mono font-semibold">{opt}.</span>
                                  <span className="flex-1">{q.options[opt]}</span>
                                </button>
                              )
                            })}
                          </div>

                          {submitted && (
                            <div className="space-y-1.5 rounded-lg border border-line bg-void/55 p-3 text-[11.5px] leading-relaxed text-dim">
                              <div>
                                <span className="font-mono font-semibold text-ice">深度解析：</span>
                                {q.explanation}
                              </div>
                              {q.ba2Tip && (
                                <div className="font-mono text-[11px] text-gold">
                                  BA II Plus 按键：{q.ba2Tip}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {!currentQuiz.submitted && (
                      <div className="flex items-center justify-between border-t border-line pt-3">
                        <span className="font-mono text-[11px] tabular-nums text-faint">
                          已作答 {Object.keys(currentQuiz.answers).length} / {currentQuiz.questions.length} 题
                        </span>
                        <button
                          type="button"
                          onClick={() => wb.submitUnitQuiz(currentUnit.id)}
                          disabled={Object.keys(currentQuiz.answers).length === 0}
                          className="rounded-lg border border-bull/60 bg-bull/15 px-5 py-2 font-mono text-[12px] font-semibold text-bull transition hover:bg-bull/25 disabled:opacity-40"
                        >
                          提交判分
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* 无限刷题模式 */}
      {subView === 'drill' && (
        <section className="panel space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div>
              <h2 className="flex items-center gap-2 font-mono text-[14px] font-semibold text-gold">
                <InfinityIcon className="size-4" />
                <span>已学进度内无限刷题模式（严格不超纲）</span>
              </h2>
              <p className="mt-0.5 text-[11.5px] text-dim">
                出题范围严格锁定为「已完成」章节；答错自动进入错题本。
                {drillStats.total > 0 && (
                  <span className="ml-2 font-mono tabular-nums text-ice">
                    本轮战绩：{drillStats.correct} / {drillStats.total}（
                    {Math.round((drillStats.correct / drillStats.total) * 100)}%）
                  </span>
                )}
              </p>
            </div>

            {wb.completedUnits.length > 0 && (
              <button
                type="button"
                onClick={() => void handleNextDrillQuestion()}
                disabled={drillLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gold/55 bg-gold/15 px-4 py-2 font-mono text-[12px] font-semibold text-gold transition hover:bg-gold/25 disabled:opacity-50"
              >
                {drillLoading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {drillQuestion ? '下一题' : '开始抽第 1 题'}
              </button>
            )}
          </div>

          {wb.completedUnits.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line-2 p-8 text-center space-y-3">
              <GraduationCap className="mx-auto size-9 text-gold/70" />
              <h3 className="font-mono text-[13px] font-semibold text-ink">
                暂未解锁无限刷题题库
              </h3>
              <p className="mx-auto max-w-lg text-[12px] text-dim">
                为保证绝对不考察未学内容，请先在「跟课精讲与目录」中完成至少 1 个章节的过关测验（或将该节手动标为「已完成」）。
              </p>
              <button
                type="button"
                onClick={() => switchSubView('study')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gold/50 bg-gold/12 px-4 py-2 font-mono text-[11.5px] text-gold"
              >
                前往章节目录学习
              </button>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-line bg-void/50 px-3 py-2 font-mono text-[11px] text-dim">
                当前允许出题范围（{wb.completedUnits.length} 节已完成）：
                <span className="ml-1 text-ink">
                  {wb.completedUnits.map((u) => u.code).join(' · ')}
                </span>
              </div>

              {drillError && (
                <div className="flex items-start gap-2 rounded-lg border border-bear/45 bg-bear/10 px-3 py-2 text-[12px] text-bear">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{drillError}</span>
                </div>
              )}

              {drillLoading ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 font-mono text-[12px] text-dim">
                  <LoaderCircle className="size-6 animate-spin text-gold" />
                  <span>正在从已完成章节原文中命制全新练习题…</span>
                </div>
              ) : drillQuestion ? (
                <div className="rounded-xl border border-line bg-panel-2/60 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                    <span className="text-ice">
                      考查章节：{drillQuestion.unitTitle} ·{' '}
                      {drillQuestion.kind === 'calculation' ? '计算实务题' : '概念辨析题'}
                    </span>
                    {drillRelay && (
                      <span className="text-faint">{formatRelayBadge(drillRelay)}</span>
                    )}
                  </div>

                  <p className="text-[14px] leading-relaxed text-ink">{drillQuestion.stem}</p>

                  <div className="space-y-2">
                    {(['A', 'B', 'C'] as const).map((opt) => {
                      const answered = drillChoice !== null
                      const picked = drillChoice === opt
                      const isRightOpt = answered && drillQuestion.answer === opt
                      const isWrongPicked = answered && picked && drillQuestion.answer !== opt
                      return (
                        <button
                          key={opt}
                          type="button"
                          disabled={answered}
                          onClick={() => handleSelectDrillChoice(opt)}
                          className={cn(
                            'flex w-full items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-left text-[12.5px] transition',
                            isRightOpt
                              ? 'border-bull/60 bg-bull/15 text-bull'
                              : isWrongPicked
                                ? 'border-bear/60 bg-bear/15 text-bear'
                                : 'border-line bg-void/45 text-dim hover:border-gold/50 hover:text-ink',
                          )}
                        >
                          <span className="font-mono font-semibold">{opt}.</span>
                          <span className="flex-1">{drillQuestion.options[opt]}</span>
                        </button>
                      )
                    })}
                  </div>

                  {drillChoice !== null && (
                    <div className="space-y-2 rounded-lg border border-line bg-void/65 p-3.5 text-[12px]">
                      <div
                        className={cn(
                          'font-mono font-semibold',
                          drillChoice === drillQuestion.answer ? 'text-bull' : 'text-bear',
                        )}
                      >
                        {drillChoice === drillQuestion.answer
                          ? `回答正确！正确答案：${drillQuestion.answer}`
                          : `回答有误（你选了 ${drillChoice}，正确为 ${drillQuestion.answer}）· 已自动收入「错题本」`}
                      </div>
                      <p className="leading-relaxed text-dim">{drillQuestion.explanation}</p>
                      {drillQuestion.ba2Tip && (
                        <div className="font-mono text-[11px] text-gold">
                          BA II Plus 按键：{drillQuestion.ba2Tip}
                        </div>
                      )}
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => void handleNextDrillQuestion()}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gold/55 bg-gold/15 px-4 py-1.5 font-mono text-[11.5px] font-semibold text-gold transition hover:bg-gold/25"
                        >
                          <span>继续下一题</span>
                          <ArrowRight className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-10 text-center font-mono text-[12px] text-dim">
                  点击右上角「开始抽第 1 题」，系统将从你已完成的 {wb.completedUnits.length} 个单元中无限出题练习。
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* 错题本 */}
      {subView === 'mistakes' && (
        <section className="panel space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div>
              <h2 className="flex items-center gap-2 font-mono text-[14px] font-semibold text-bear">
                <Flame className="size-4" />
                <span>CFA 错题本（自动收录并支持二次重刷）</span>
              </h2>
              <p className="mt-0.5 text-[11.5px] text-dim">
                单元过关测验或无限刷题中的错题会自动汇入此处；重做确认无误后可标为「已掌握」。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(['unmastered', 'all', 'mastered'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setMistakeFilter(f)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 font-mono text-[11px] transition',
                    mistakeFilter === f
                      ? 'border-gold/50 bg-gold/12 text-gold'
                      : 'border-line text-dim hover:text-ink',
                  )}
                >
                  {f === 'unmastered' ? '待复习' : f === 'mastered' ? '已掌握' : '全部'}
                </button>
              ))}

              <select
                value={mistakeTopic}
                onChange={(e) => setMistakeTopic(e.target.value as CfaTopicId | 'all')}
                className="rounded-lg border border-line bg-void px-2.5 py-1 font-mono text-[11px] text-dim"
              >
                <option value="all">全部科目</option>
                {CFA_TOPICS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} · {t.nameZh}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredMistakes.length === 0 ? (
            <div className="py-10 text-center font-mono text-[12px] text-faint">
              当前筛选条件下暂无错题记录。
            </div>
          ) : (
            <div className="space-y-3">
              {filteredMistakes.map((m) => {
                const retry = mistakeRetryChoice[m.id]
                const showAnswer = Boolean(mistakeExpanded[m.id] || retry)
                return (
                  <div
                    key={m.id}
                    className="rounded-xl border border-line bg-panel-2/60 p-4 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10.5px]">
                      <div className="flex flex-wrap items-center gap-2 text-dim">
                        <span className="text-ice">{m.unitTitle}</span>
                        <span className="text-faint">·</span>
                        <span>{m.source === 'infinite_drill' ? '无限刷题错题' : '过关测验错题'}</span>
                        <span className="text-faint">·</span>
                        <span className="text-bear">原误选 {m.userChoice}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setMistakeExpanded((prev) => ({ ...prev, [m.id]: !prev[m.id] }))
                          }
                          className="rounded border border-line-2 px-2 py-0.5 text-dim hover:text-ink"
                        >
                          {showAnswer ? '隐藏解析' : '看解析'}
                        </button>
                        <button
                          type="button"
                          onClick={() => wb.toggleMistakeMastered(m.id)}
                          className={cn(
                            'rounded border px-2 py-0.5 transition',
                            m.mastered
                              ? 'border-bull/50 bg-bull/12 text-bull'
                              : 'border-line-2 text-dim hover:border-bull/50 hover:text-bull',
                          )}
                        >
                          {m.mastered ? '已掌握' : '标为已掌握'}
                        </button>
                        <button
                          type="button"
                          onClick={() => wb.deleteMistake(m.id)}
                          className="rounded p-1 text-faint hover:text-bear"
                          title="删除错题"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-[13px] leading-relaxed text-ink">{m.question.stem}</p>

                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                      {(['A', 'B', 'C'] as const).map((opt) => {
                        const picked = retry === opt
                        const isRight = showAnswer && m.question.answer === opt
                        const isWrong = Boolean(retry) && picked && m.question.answer !== opt
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() =>
                              setMistakeRetryChoice((prev) => ({ ...prev, [m.id]: opt }))
                            }
                            className={cn(
                              'flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-[11.5px] transition',
                              isRight
                                ? 'border-bull/60 bg-bull/12 text-bull'
                                : isWrong
                                  ? 'border-bear/60 bg-bear/12 text-bear'
                                  : 'border-line bg-void/45 text-dim hover:border-line-2',
                            )}
                          >
                            <span className="font-mono font-semibold">{opt}.</span>
                            <span>{m.question.options[opt]}</span>
                          </button>
                        )
                      })}
                    </div>

                    {showAnswer && (
                      <div className="space-y-1 rounded-lg border border-line bg-void/55 p-3 text-[11.5px] text-dim">
                        <div>
                          <span className="font-mono font-semibold text-bull">
                            正确答案：{m.question.answer} ·{' '}
                          </span>
                          {m.question.explanation}
                        </div>
                        {m.question.ba2Tip && (
                          <div className="font-mono text-[11px] text-gold">
                            BA II Plus：{m.question.ba2Tip}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* 导入 2027 Handbook 章节 */}
      {subView === 'import' && (
        <section className="panel space-y-4 p-4 sm:p-5">
          <div className="border-b border-line pb-3">
            <h2 className="flex items-center gap-2 font-mono text-[14px] font-semibold text-gold">
              <Upload className="size-4" />
              <span>导入 2027 CFA L1 Handbook（PDF 本地提取或粘贴原文）</span>
            </h2>
            <p className="mt-1 text-[11.5px] text-dim">
              支持按科目上传 Official 2027 Handbook PDF 或直接粘贴原文；系统将自动识别 Learning Module / Reading / Chapter 并拆分为结构化章节存入本地学习进度。
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="font-mono text-[10.5px] text-dim uppercase">
                所属 CFA 科目（Topic）
              </label>
              <select
                value={importTopic}
                onChange={(e) => setImportTopic(e.target.value as CfaTopicId)}
                className="mt-1 w-full rounded-lg border border-line bg-void/70 px-3 py-2 font-mono text-[12px] text-ink focus:border-gold/55"
              >
                {CFA_TOPICS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} · {t.nameZh} ({t.nameEn}) — 权重 {t.weight2027}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-mono text-[10.5px] text-dim uppercase">
                单节自定义标题（可选；留空则自动识别多节 Learning Module）
              </label>
              <input
                type="text"
                value={importTitle}
                onChange={(e) => setImportTitle(e.target.value)}
                placeholder="例如：LM 3 Statistical Measures of Asset Returns"
                className="mt-1 w-full rounded-lg border border-line bg-void/70 px-3 py-2 text-[12px] text-ink placeholder:text-faint/60 focus:border-gold/55"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain"
              className="hidden"
              onChange={(e) => {
                void handleUploadFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ice/50 bg-ice/12 px-3.5 py-2 font-mono text-[11.5px] font-medium text-ice transition hover:bg-ice/20"
            >
              <Upload className="size-3.5" />
              上传 PDF / TXT 文件（纯浏览器本地提取）
            </button>

            {pdfProgress && (
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-gold">
                <LoaderCircle className="size-3.5 animate-spin" />
                {pdfProgress}
              </span>
            )}
            {importSourceName && !pdfProgress && (
              <span className="font-mono text-[11px] text-dim">当前文件：{importSourceName}</span>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="font-mono text-[10.5px] text-dim uppercase">
                2027 Handbook 原文文本
              </label>
              {importText && (
                <button
                  type="button"
                  onClick={() => {
                    setImportText('')
                    setImportSourceName('')
                    setImportFeedback(null)
                  }}
                  className="font-mono text-[10.5px] text-faint hover:text-bear"
                >
                  清空文本
                </button>
              )}
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={10}
              placeholder="在此直接粘贴 2027 Handbook 章节正文（或通过上方按钮上传 PDF 自动提取文本）..."
              className="mt-1 w-full rounded-xl border border-line bg-void/70 p-3 font-mono text-[11.5px] leading-relaxed text-ink placeholder:text-faint/60 focus:border-gold/55"
            />
          </div>

          {importFeedback && (
            <div className="rounded-lg border border-ice/35 bg-ice/10 px-3 py-2 font-mono text-[11px] text-ice">
              {importFeedback}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => switchSubView('study')}
              className="rounded-lg border border-line-2 px-3.5 py-2 font-mono text-[11.5px] text-dim hover:text-ink"
            >
              返回目录
            </button>
            <button
              type="button"
              onClick={handleConfirmImport}
              disabled={!importText.trim() || Boolean(pdfProgress)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gold/55 bg-gold/15 px-4 py-2 font-mono text-[12px] font-semibold text-gold transition hover:bg-gold/25 disabled:opacity-40"
            >
              <Plus className="size-4" />
              解析并导入为结构化单元
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
