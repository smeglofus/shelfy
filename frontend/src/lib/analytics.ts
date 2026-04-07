/**
 * Thin analytics wrapper — PostHog (self-hosted or cloud).
 *
 * All functions are safe no-ops when VITE_POSTHOG_KEY is not set, so the
 * app works in development and CI without any analytics credentials.
 *
 * Setup (production):
 *   VITE_POSTHOG_KEY=phc_xxxx           # your PostHog project API key
 *   VITE_POSTHOG_HOST=https://ph.shelfy.app   # your self-hosted instance (or eu.posthog.com)
 *
 * Self-hosted PostHog:  https://posthog.com/docs/self-host
 *
 * Key funnel events tracked:
 *   signup              — user registered successfully
 *   login               — user signed in
 *   shelf_scanned       — shelf scan confirmed (books added)
 *   upgrade_clicked     — user clicked an upgrade button
 *   billing_success     — user returned from Stripe with billing_success=1
 */

import type { PostHog } from 'posthog-js'

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.posthog.com'

// Holds the PostHog instance after initAnalytics() resolves.
let _ph: PostHog | undefined

/**
 * Initialize PostHog. Called once from main.tsx.
 * Safe to call when VITE_POSTHOG_KEY is absent — becomes a no-op.
 */
export async function initAnalytics(): Promise<void> {
  if (!POSTHOG_KEY) return

  try {
    const { default: posthog } = await import('posthog-js')
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      // Only create profiles for identified users — avoids anonymous event spam
      // and reduces PII stored for GDPR compliance.
      person_profiles: 'identified_only',
      // localStorage instead of cookies — GDPR-friendly, no consent banner needed.
      persistence: 'localStorage',
      // Disable auto-capture of clicks/forms — we track only explicit events.
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: true,
    })
    _ph = posthog
  } catch {
    // Gracefully ignore load failures (network block, ad-blocker, etc.)
  }
}

/** Track a named product event with optional metadata. */
export function trackEvent(event: string, props?: Record<string, unknown>): void {
  _ph?.capture(event, props)
}

/**
 * Associate subsequent events with a known user.
 * Call after successful login or registration.
 */
export function identifyUser(id: string): void {
  _ph?.identify(id)
}

/** Disassociate the current user. Call on logout. */
export function resetUser(): void {
  _ph?.reset()
}
