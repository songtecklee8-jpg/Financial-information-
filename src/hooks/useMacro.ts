import { useCallback, useState } from 'react'

import type { MacroRates } from '@/types'
import { baselineMacro, jitterMacro } from '@/lib/macro'

export interface MacroController {
  macro: MacroRates
  refresh: () => void
}

export function useMacro(): MacroController {
  const [macro, setMacro] = useState<MacroRates>(() => baselineMacro())
  const refresh = useCallback(() => setMacro((previous) => jitterMacro(previous)), [])
  return { macro, refresh }
}
