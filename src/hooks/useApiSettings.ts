import { useCallback, useEffect, useState } from 'react'

import type { ApiSettings, ProviderConfig, ProviderId } from '@/types'
import { DEFAULT_GEMINI_MODEL } from '@/lib/gemini'
import { PROVIDER_IDS, isProviderConfigured } from '@/lib/market/registry'

/** v2 结构：providers 覆盖全部行情引擎；v1 的 twelveDataKey 会自动迁移 */
const STORAGE_KEY = 'apex-terminal:api-settings:v2'
const LEGACY_KEY = 'apex-terminal:api-settings:v1'

function emptyProviders(): Record<ProviderId, ProviderConfig> {
  const out = {} as Record<ProviderId, ProviderConfig>
  for (const id of PROVIDER_IDS) out[id] = { apiKey: '', secretKey: '' }
  return out
}

export const DEFAULT_API_SETTINGS: ApiSettings = {
  geminiKey: '',
  geminiModel: DEFAULT_GEMINI_MODEL,
  providers: emptyProviders(),
}

function read(): ApiSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_API_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY)
    if (!raw) return DEFAULT_API_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ApiSettings> & { twelveDataKey?: string }
    const providers = emptyProviders()
    if (parsed.providers) {
      for (const id of PROVIDER_IDS) {
        const config = parsed.providers[id]
        if (config) {
          providers[id] = {
            apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
            secretKey: typeof config.secretKey === 'string' ? config.secretKey : '',
          }
        }
      }
    } else if (typeof parsed.twelveDataKey === 'string' && parsed.twelveDataKey.trim()) {
      // v1 → v2 迁移：旧 Twelve Data Key 归入 providers.twelvedata
      providers.twelvedata = { apiKey: parsed.twelveDataKey, secretKey: '' }
    }
    return {
      geminiKey: typeof parsed.geminiKey === 'string' ? parsed.geminiKey : '',
      geminiModel:
        typeof parsed.geminiModel === 'string' && parsed.geminiModel.trim()
          ? parsed.geminiModel
          : DEFAULT_GEMINI_MODEL,
      providers,
    }
  } catch {
    return DEFAULT_API_SETTINGS
  }
}

export interface ApiSettingsController {
  settings: ApiSettings
  save: (next: ApiSettings) => void
  reset: () => void
  hasGemini: boolean
  /** 已配置（可参与故障转移）的行情引擎数量 */
  configuredCount: number
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
  const reset = useCallback(() => setSettings(DEFAULT_API_SETTINGS), [])

  const configuredCount = PROVIDER_IDS.filter((id) =>
    isProviderConfigured(
      id,
      settings.providers[id]?.apiKey ?? '',
      settings.providers[id]?.secretKey ?? '',
    ),
  ).length

  return {
    settings,
    save,
    reset,
    hasGemini: settings.geminiKey.trim().length > 0,
    configuredCount,
  }
}
