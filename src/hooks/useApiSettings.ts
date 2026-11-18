import { useCallback, useEffect, useState } from 'react'

import type { ApiSettings } from '@/types'
import { DEFAULT_GEMINI_MODEL } from '@/lib/gemini'

const STORAGE_KEY = 'apex-terminal:api-settings:v1'

const DEFAULTS: ApiSettings = {
  twelveDataKey: '',
  geminiKey: '',
  geminiModel: DEFAULT_GEMINI_MODEL,
}

function read(): ApiSettings {
  if (typeof localStorage === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<ApiSettings>
    return {
      twelveDataKey: typeof parsed.twelveDataKey === 'string' ? parsed.twelveDataKey : '',
      geminiKey: typeof parsed.geminiKey === 'string' ? parsed.geminiKey : '',
      geminiModel:
        typeof parsed.geminiModel === 'string' && parsed.geminiModel.trim()
          ? parsed.geminiModel
          : DEFAULT_GEMINI_MODEL,
    }
  } catch {
    return DEFAULTS
  }
}

export interface ApiSettingsController {
  settings: ApiSettings
  save: (next: ApiSettings) => void
  reset: () => void
  hasTwelveData: boolean
  hasGemini: boolean
}

export function useApiSettings(): ApiSettingsController {
  const [settings, setSettings] = useState<ApiSettings>(() => read())

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      /* 隐私模式下 localStorage 不可写，忽略 */
    }
  }, [settings])

  const save = useCallback((next: ApiSettings) => setSettings(next), [])
  const reset = useCallback(() => setSettings(DEFAULTS), [])

  return {
    settings,
    save,
    reset,
    hasTwelveData: settings.twelveDataKey.trim().length > 0,
    hasGemini: settings.geminiKey.trim().length > 0,
  }
}
