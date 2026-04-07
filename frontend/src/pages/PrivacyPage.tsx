import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'

const SECTION_STYLE: CSSProperties = { marginBottom: 28 }
const H2_STYLE: CSSProperties = { fontSize: 18, fontWeight: 700, margin: '0 0 8px' }
const P_STYLE: CSSProperties = { margin: '0 0 10px', lineHeight: 1.6, color: 'var(--sh-text-secondary)' }

export function PrivacyPage() {
  const navigate = useNavigate()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sh-bg)' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 24px',
          borderBottom: '1px solid var(--sh-border)',
          background: 'var(--sh-surface)',
        }}
      >
        <button
          type='button'
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 20 }}
          onClick={() => navigate('/')}
        >
          📚 Shelfy
        </button>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 80px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>Privacy Policy</h1>
        <p style={{ ...P_STYLE, marginBottom: 32 }}>
          Last updated: April 6, 2026. If you have questions, contact us at{' '}
          <a href='mailto:privacy@shelfy.app' style={{ color: 'var(--sh-primary)' }}>privacy@shelfy.app</a>.
        </p>

        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>1. What data we collect</h2>
          <p style={P_STYLE}>
            We collect the minimum data required to provide the Shelfy service:
          </p>
          <ul style={{ paddingLeft: 20, color: 'var(--sh-text-secondary)', lineHeight: 1.7, margin: '0 0 10px' }}>
            <li><strong>Account data:</strong> your email address and a bcrypt-hashed password.</li>
            <li><strong>Library data:</strong> books, loans, locations, and shelf scan results you create.</li>
            <li><strong>Billing data:</strong> subscription plan and Stripe customer ID (we never store your card details — Stripe handles payment data).</li>
            <li><strong>Usage data:</strong> monthly counters for scans and enrichment requests (used for quota enforcement).</li>
            <li><strong>Technical logs:</strong> server access logs and structured application logs (retained for 30 days).</li>
          </ul>
        </div>

        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>2. How we use your data</h2>
          <p style={P_STYLE}>
            We use your data exclusively to provide and improve the Shelfy service. We do not sell or share
            personal data with third parties for marketing purposes. Third-party sub-processors we use:
          </p>
          <ul style={{ paddingLeft: 20, color: 'var(--sh-text-secondary)', lineHeight: 1.7, margin: '0 0 10px' }}>
            <li><strong>Stripe</strong> — payment processing (EU data residency available)</li>
            <li><strong>Google Gemini API</strong> — AI image analysis for shelf scanning (images are not retained by Google)</li>
            <li><strong>Sentry</strong> — optional error tracking (only enabled in production)</li>
          </ul>
        </div>

        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>3. Your rights (GDPR)</h2>
          <p style={P_STYLE}>
            Under the General Data Protection Regulation (EU 2016/679), you have the following rights:
          </p>
          <ul style={{ paddingLeft: 20, color: 'var(--sh-text-secondary)', lineHeight: 1.7, margin: '0 0 10px' }}>
            <li><strong>Right of access (Art. 15):</strong> request a copy of your personal data.</li>
            <li><strong>Right to rectification (Art. 16):</strong> correct inaccurate data.</li>
            <li><strong>Right to erasure (Art. 17):</strong> delete your account and all associated data from Settings → Danger Zone → Delete account.</li>
            <li><strong>Right to data portability (Art. 20):</strong> download a full JSON export of your data from Settings → Export my data.</li>
            <li><strong>Right to object (Art. 21):</strong> object to processing in certain circumstances.</li>
          </ul>
          <p style={P_STYLE}>
            To exercise rights that are not covered by the in-app tools, contact{' '}
            <a href='mailto:privacy@shelfy.app' style={{ color: 'var(--sh-primary)' }}>privacy@shelfy.app</a>.
          </p>
        </div>

        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>4. Data retention</h2>
          <p style={P_STYLE}>
            Your data is retained for as long as your account exists. When you delete your account, all
            personal data is permanently removed within 30 days (backups are rotated on a 30-day cycle).
            Stripe may retain transaction records for legal compliance purposes.
          </p>
        </div>


        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>5. Product analytics (PostHog)</h2>
          <p style={P_STYLE}>
            We use privacy-first product analytics via PostHog to understand feature usage
            (e.g. signup, shelf scan completion, upgrade click). We do not send book contents,
            images, or payment card data to analytics.
          </p>
          <p style={P_STYLE}>
            Analytics runs without tracking cookies (localStorage persistence) and can be
            disabled by configuration on self-hosted deployments.
          </p>
        </div>

        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>6. Cookies</h2>
          <p style={P_STYLE}>
            Shelfy does not use tracking cookies. We use localStorage to store your authentication tokens
            and UI preferences (dark mode, language). This data never leaves your device.
          </p>
        </div>

        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>7. Data controller</h2>
          <p style={P_STYLE}>
            The data controller is the operator of shelfy.app. For enquiries, write to{' '}
            <a href='mailto:privacy@shelfy.app' style={{ color: 'var(--sh-primary)' }}>privacy@shelfy.app</a>.
          </p>
        </div>

        <button
          type='button'
          className='sh-btn-secondary'
          style={{ marginTop: 8 }}
          onClick={() => navigate(-1)}
        >
          ← Back
        </button>
      </main>
    </div>
  )
}
