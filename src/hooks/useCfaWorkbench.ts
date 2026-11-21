import { useCallback, useEffect, useState } from 'react'

import type {
  CfaLectureNote,
  CfaMistakeRecord,
  CfaQaMessage,
  CfaQuestion,
  CfaQuestionMode,
  CfaQuizAttempt,
  CfaTopicId,
  CfaUnit,
} from '@/types'
import { STARTER_CFA_UNITS } from '@/lib/cfaPdf'

const STORAGE_KEY = 'apex-research:cfa-l1-2027:v1'

export type CfaSubView = 'study' | 'quiz' | 'drill' | 'mistakes' | 'import'

interface CfaPersistedState {
  units: CfaUnit[]
  lectures: Record<string, CfaLectureNote>
  qaByUnit: Record<string, CfaQaMessage[]>
  quizzesByUnit: Record<string, CfaQuizAttempt>
  mistakes: CfaMistakeRecord[]
  lastUnitId: string | null
  lastSubView: CfaSubView
  questionMode: CfaQuestionMode
}

const DEFAULT_STATE: CfaPersistedState = {
  units: STARTER_CFA_UNITS,
  lectures: {},
  qaByUnit: {},
  quizzesByUnit: {},
  mistakes: [],
  lastUnitId: STARTER_CFA_UNITS[0]?.id ?? null,
  lastSubView: 'study',
  questionMode: 'mixed',
}

function loadState(): CfaPersistedState {
  if (typeof localStorage === 'undefined') return DEFAULT_STATE
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<CfaPersistedState>
    const units = Array.isArray(parsed.units) && parsed.units.length > 0 ? parsed.units : STARTER_CFA_UNITS
    return {
      units,
      lectures: parsed.lectures && typeof parsed.lectures === 'object' ? parsed.lectures : {},
      qaByUnit: parsed.qaByUnit && typeof parsed.qaByUnit === 'object' ? parsed.qaByUnit : {},
      quizzesByUnit: parsed.quizzesByUnit && typeof parsed.quizzesByUnit === 'object' ? parsed.quizzesByUnit : {},
      mistakes: Array.isArray(parsed.mistakes) ? parsed.mistakes : [],
      lastUnitId: typeof parsed.lastUnitId === 'string' ? parsed.lastUnitId : units[0]?.id ?? null,
      lastSubView:
        parsed.lastSubView === 'study' ||
        parsed.lastSubView === 'quiz' ||
        parsed.lastSubView === 'drill' ||
        parsed.lastSubView === 'mistakes' ||
        parsed.lastSubView === 'import'
          ? parsed.lastSubView
          : 'study',
      questionMode:
        parsed.questionMode === 'calculation' || parsed.questionMode === 'conceptual'
          ? parsed.questionMode
          : 'mixed',
    }
  } catch {
    return DEFAULT_STATE
  }
}

export function useCfaWorkbench() {
  const [state, setState] = useState<CfaPersistedState>(loadState)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* ignore quota error */
    }
  }, [state])

  const selectUnit = useCallback((unitId: string, subView: CfaSubView = 'study') => {
    const now = new Date().toISOString()
    setState((prev) => ({
      ...prev,
      lastUnitId: unitId,
      lastSubView: subView,
      units: prev.units.map((u) =>
        u.id === unitId
          ? {
              ...u,
              status: u.status === 'not_started' ? 'in_progress' : u.status,
              lastVisitedAt: now,
            }
          : u,
      ),
    }))
  }, [])

  const setSubView = useCallback((subView: CfaSubView) => {
    setState((prev) => ({ ...prev, lastSubView: subView }))
  }, [])

  const setQuestionMode = useCallback((questionMode: CfaQuestionMode) => {
    setState((prev) => ({ ...prev, questionMode }))
  }, [])

  const importUnits = useCallback((newUnits: CfaUnit[]) => {
    if (newUnits.length === 0) return
    const now = new Date().toISOString()
    setState((prev) => ({
      ...prev,
      units: [...prev.units, ...newUnits],
      lastUnitId: newUnits[0]!.id,
      lastSubView: 'study',
      // 首次导入新章节自动切换至学习态
    }))
    void now
  }, [])

  const deleteUnit = useCallback((unitId: string) => {
    setState((prev) => {
      const remaining = prev.units.filter((u) => u.id !== unitId)
      const nextLast = prev.lastUnitId === unitId ? remaining[0]?.id ?? null : prev.lastUnitId
      const { [unitId]: _l, ...restLectures } = prev.lectures
      const { [unitId]: _q, ...restQa } = prev.qaByUnit
      const { [unitId]: _z, ...restQuizzes } = prev.quizzesByUnit
      return {
        ...prev,
        units: remaining,
        lectures: restLectures,
        qaByUnit: restQa,
        quizzesByUnit: restQuizzes,
        lastUnitId: nextLast,
      }
    })
  }, [])

  const saveLecture = useCallback((note: CfaLectureNote) => {
    const now = new Date().toISOString()
    setState((prev) => ({
      ...prev,
      lectures: { ...prev.lectures, [note.unitId]: note },
      units: prev.units.map((u) =>
        u.id === note.unitId
          ? {
              ...u,
              status: u.status === 'not_started' ? 'in_progress' : u.status,
              lastVisitedAt: now,
            }
          : u,
      ),
    }))
  }, [])

  const appendQaMessage = useCallback((unitId: string, msg: CfaQaMessage) => {
    setState((prev) => ({
      ...prev,
      qaByUnit: {
        ...prev.qaByUnit,
        [unitId]: [...(prev.qaByUnit[unitId] ?? []), msg],
      },
    }))
  }, [])

  const clearQa = useCallback((unitId: string) => {
    setState((prev) => ({
      ...prev,
      qaByUnit: { ...prev.qaByUnit, [unitId]: [] },
    }))
  }, [])

  const saveQuizAttempt = useCallback((attempt: CfaQuizAttempt) => {
    setState((prev) => ({
      ...prev,
      quizzesByUnit: { ...prev.quizzesByUnit, [attempt.unitId]: attempt },
    }))
  }, [])

  const updateQuizAnswer = useCallback((unitId: string, questionId: string, choice: 'A' | 'B' | 'C') => {
    setState((prev) => {
      const existing = prev.quizzesByUnit[unitId]
      if (!existing || existing.submitted) return prev
      return {
        ...prev,
        quizzesByUnit: {
          ...prev.quizzesByUnit,
          [unitId]: {
            ...existing,
            answers: { ...existing.answers, [questionId]: choice },
          },
        },
      }
    })
  }, [])

  const addMistakes = useCallback(
    (items: Array<{ question: CfaQuestion; userChoice: 'A' | 'B' | 'C'; source: 'unit_quiz' | 'infinite_drill' }>) => {
      if (items.length === 0) return
      const now = new Date().toISOString()
      setState((prev) => {
        const nextMistakes = [...prev.mistakes]
        for (const item of items) {
          const existingIdx = nextMistakes.findIndex(
            (m) => m.question.stem.trim() === item.question.stem.trim(),
          )
          if (existingIdx >= 0) {
            const cur = nextMistakes[existingIdx]!
            nextMistakes[existingIdx] = {
              ...cur,
              userChoice: item.userChoice,
              mastered: false,
              reviewCount: cur.reviewCount + 1,
              createdAt: now,
            }
          } else {
            nextMistakes.unshift({
              id: `mistake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              unitId: item.question.unitId,
              unitTitle: item.question.unitTitle,
              topicId: item.question.topicId,
              question: item.question,
              userChoice: item.userChoice,
              source: item.source,
              createdAt: now,
              mastered: false,
              reviewCount: 0,
            })
          }
        }
        return { ...prev, mistakes: nextMistakes.slice(0, 300) }
      })
    },
    [],
  )

  const submitUnitQuiz = useCallback(
    (unitId: string) => {
      const now = new Date().toISOString()
      let wrongItems: Array<{ question: CfaQuestion; userChoice: 'A' | 'B' | 'C'; source: 'unit_quiz' }> = []
      setState((prev) => {
        const attempt = prev.quizzesByUnit[unitId]
        if (!attempt) return prev
        let score = 0
        wrongItems = []
        for (const q of attempt.questions) {
          const choice = attempt.answers[q.id]
          if (choice === q.answer) {
            score += 1
          } else if (choice) {
            wrongItems.push({ question: q, userChoice: choice, source: 'unit_quiz' })
          }
        }
        const total = attempt.questions.length
        const passed = total > 0 && score >= Math.ceil(total * 0.6)
        const updatedAttempt: CfaQuizAttempt = {
          ...attempt,
          submitted: true,
          score,
          total,
          passed,
        }
        return {
          ...prev,
          quizzesByUnit: { ...prev.quizzesByUnit, [unitId]: updatedAttempt },
          units: prev.units.map((u) =>
            u.id === unitId
              ? {
                  ...u,
                  status: passed ? 'completed' : 'in_progress',
                  completedAt: passed ? now : u.completedAt,
                  lastQuizScore: score,
                  lastQuizTotal: total,
                  lastVisitedAt: now,
                }
              : u,
          ),
        }
      })
      if (wrongItems.length > 0) {
        addMistakes(wrongItems)
      }
    },
    [addMistakes],
  )

  const setUnitStatus = useCallback((unitId: string, status: CfaUnit['status']) => {
    const now = new Date().toISOString()
    setState((prev) => ({
      ...prev,
      units: prev.units.map((u) =>
        u.id === unitId
          ? {
              ...u,
              status,
              completedAt: status === 'completed' ? now : u.completedAt,
              lastVisitedAt: now,
            }
          : u,
      ),
    }))
  }, [])

  const toggleMistakeMastered = useCallback((mistakeId: string) => {
    setState((prev) => ({
      ...prev,
      mistakes: prev.mistakes.map((m) =>
        m.id === mistakeId ? { ...m, mastered: !m.mastered, reviewCount: m.reviewCount + 1 } : m,
      ),
    }))
  }, [])

  const deleteMistake = useCallback((mistakeId: string) => {
    setState((prev) => ({
      ...prev,
      mistakes: prev.mistakes.filter((m) => m.id !== mistakeId),
    }))
  }, [])

  const nextOrderForTopic = useCallback(
    (topicId: CfaTopicId) => state.units.filter((u) => u.topicId === topicId).length + 1,
    [state.units],
  )

  const completedUnits = state.units.filter((u) => u.status === 'completed')
  const currentUnit =
    state.units.find((u) => u.id === state.lastUnitId) ?? state.units[0] ?? null

  return {
    ...state,
    currentUnit,
    completedUnits,
    selectUnit,
    setSubView,
    setQuestionMode,
    importUnits,
    deleteUnit,
    saveLecture,
    appendQaMessage,
    clearQa,
    saveQuizAttempt,
    updateQuizAnswer,
    submitUnitQuiz,
    setUnitStatus,
    addMistakes,
    toggleMistakeMastered,
    deleteMistake,
    nextOrderForTopic,
  }
}
