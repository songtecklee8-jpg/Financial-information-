import { useCallback, useState } from 'react'

import { ApiSettingsModal } from '@/components/ApiSettingsModal'
import { NewsHubPage } from '@/components/news/NewsHubPage'
import { EarningsAnalysisWorkspace } from '@/components/analysis/EarningsAnalysisWorkspace'
import { TopBar, type AppView } from '@/components/TopBar'
import { useApiSettings } from '@/hooks/useApiSettings'

export default function App() {
  const [view, setView] = useState<AppView>('news')
  const [settingsOpen, setSettingsOpen] = useState(false)

  const api = useApiSettings()
  const openSettings = useCallback(() => setSettingsOpen(true), [])

  return (
    <div className="relative flex min-h-full flex-col">
      <div className="term-backdrop" aria-hidden />

      <div className="relative z-10 flex min-h-full flex-1 flex-col">
        <TopBar
          onOpenSettings={openSettings}
          view={view}
          onNavigate={setView}
          hasGemini={api.hasGemini}
          backupAiCount={api.backupAiCount}
        />

        {view === 'news' ? (
          <NewsHubPage settings={api.settings} symbol="" onOpenSettings={openSettings} />
        ) : (
          <EarningsAnalysisWorkspace settings={api.settings} onOpenSettings={openSettings} />
        )}

        <footer className="mt-auto border-t border-line/60 py-3 px-4 text-center font-mono text-[10px] text-faint">
          APEX RESEARCH · 轻量级 AI 投研助手 · 多源财经新闻智能摘要与财报长文深度分析工作台
        </footer>
      </div>

      <ApiSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={api.settings}
        onSave={api.save}
        onReset={api.reset}
      />
    </div>
  )
}
