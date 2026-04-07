import './styles/shelfy.css'
import './i18n/index'

import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './contexts/AuthContext'
import { useSettingsStore } from './store/useSettingsStore'
import { reportFrontendError } from './lib/telemetry'
import { initAnalytics } from './lib/analytics'

// ── Sentry (optional — enabled only when VITE_SENTRY_DSN is set) ──────────────
const _sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
if (_sentryDsn) {
  void import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn: _sentryDsn,
      environment: (import.meta.env.VITE_ENV as string | undefined) ?? 'development',
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
      ],
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0.05,
      replaysOnErrorSampleRate: 1.0,
    })
  })
}

// ── Analytics (optional — enabled only when VITE_POSTHOG_KEY is set) ─────────
void initAnalytics()

const queryClient = new QueryClient()

useSettingsStore.getState().initialize()

window.addEventListener('error', (e) => {
  void reportFrontendError({
    kind: 'error',
    message: e.message || 'window error',
    source: e.filename,
    stack: (e.error as Error | undefined)?.stack,
    url: window.location.href,
  })
})

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as Error | string | unknown
  void reportFrontendError({
    kind: 'unhandledrejection',
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    url: window.location.href,
  })
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
