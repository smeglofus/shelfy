const endpoint = '/api/v1/telemetry/frontend-error'

let lastSentAt = 0

export async function reportFrontendError(event: {
  kind: 'error' | 'unhandledrejection' | string
  message: string
  source?: string
  stack?: string
  url?: string
}): Promise<void> {
  const now = Date.now()
  if (now - lastSentAt < 2000) return
  lastSentAt = now

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
    })
  } catch {
    // swallow telemetry errors
  }
}
