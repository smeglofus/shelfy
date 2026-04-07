import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../lib/routes'

const SECTION_STYLE: CSSProperties = { marginBottom: 28 }
const H2_STYLE: CSSProperties = { fontSize: 18, fontWeight: 700, margin: '0 0 8px' }
const P_STYLE: CSSProperties = { margin: '0 0 10px', lineHeight: 1.6, color: 'var(--sh-text-secondary)' }

export function TermsPage() {
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
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>Terms of Service</h1>
        <p style={{ ...P_STYLE, marginBottom: 32 }}>
          Last updated: April 6, 2026. By using Shelfy you agree to these terms. Questions?{' '}
          <a href='mailto:hello@shelfy.app' style={{ color: 'var(--sh-primary)' }}>hello@shelfy.app</a>
        </p>

        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>1. Service description</h2>
          <p style={P_STYLE}>
            Shelfy is a personal library management application that uses AI to catalog physical books.
            We provide a Free tier and paid plans (Pro, Library). Features and limits are described on
            the Pricing page and may change with reasonable notice.
          </p>
        </div>

        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>2. Accounts</h2>
          <p style={P_STYLE}>
            You must be 16 or older to create an account. You are responsible for keeping your credentials
            secure. One person may hold one account; sharing credentials is not permitted.
          </p>
        </div>

        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>3. Acceptable use</h2>
          <p style={P_STYLE}>You agree not to:</p>
          <ul style={{ paddingLeft: 20, color: 'var(--sh-text-secondary)', lineHeight: 1.7, margin: '0 0 10px' }}>
            <li>Attempt to reverse-engineer, scrape, or overload the service.</li>
            <li>Upload content that infringes third-party intellectual property rights.</li>
            <li>Use the service for any unlawful purpose.</li>
          </ul>
          <p style={P_STYLE}>
            We reserve the right to suspend or terminate accounts that violate these rules.
          </p>
        </div>

        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>4. Billing</h2>
          <p style={P_STYLE}>
            Paid plans are billed monthly in advance via Stripe. You may cancel at any time from
            Settings → Manage subscription; your plan remains active until the end of the current
            billing period. Refunds are handled on a case-by-case basis — contact us within 7 days
            of a charge.
          </p>
        </div>

        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>5. Data and privacy</h2>
          <p style={P_STYLE}>
            We process your personal data as described in our{' '}
            <button
              type='button'
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sh-primary)', padding: 0, fontSize: 'inherit' }}
              onClick={() => navigate(ROUTES.privacy)}
            >
              Privacy Policy
            </button>
            . You own all content you create. We do not sell your data.
          </p>
        </div>

        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>6. Service availability</h2>
          <p style={P_STYLE}>
            We aim for high availability but do not guarantee uptime. The service is provided "as is".
            We are not liable for data loss caused by user error, force majeure, or infrastructure failures.
            We perform regular automated backups; contact support if you need data recovery assistance.
          </p>
        </div>

        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>7. Limitation of liability</h2>
          <p style={P_STYLE}>
            To the maximum extent permitted by applicable law, our total liability to you for any claim
            arising from your use of Shelfy shall not exceed the amount you paid us in the 12 months
            preceding the claim, or €50, whichever is greater.
          </p>
        </div>

        <div style={SECTION_STYLE}>
          <h2 style={H2_STYLE}>8. Changes to these terms</h2>
          <p style={P_STYLE}>
            We will notify you of material changes by email at least 14 days in advance. Continued use
            after the effective date constitutes acceptance of the updated terms.
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
