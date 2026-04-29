export type ChangelogLocale = 'cs' | 'en'

type LocalizedText = Record<ChangelogLocale, string>
type LocalizedList = Partial<Record<ChangelogLocale, string[]>>

export type ChangelogEntry = {
  date: string
  title: LocalizedText
  summary: LocalizedText
  added?: LocalizedList
  changed?: LocalizedList
  fixed?: LocalizedList
}

export const changelogEntries: ChangelogEntry[] = [
  {
    date: '2026-04-29',
    title: {
      cs: 'Spolehlivější backend a přísnější CI',
      en: 'More reliable backend and stricter CI',
    },
    summary: {
      cs: 'Zpřísnili jsme backend quality gate: test coverage je zpět na 80 % a strict Mypy už není jen advisory kontrola.',
      en: 'We tightened the backend quality gate: test coverage is back at 80% and strict Mypy is now a required check.',
    },
    changed: {
      cs: [
        'Backend test coverage gate je zvýšený zpět na 80 %.',
        'Strict Mypy běží jako povinná kontrola v CI.',
      ],
      en: [
        'Backend test coverage gate is back at 80%.',
        'Strict Mypy now runs as a required CI check.',
      ],
    },
    fixed: {
      cs: [
        'Doplněné typové opravy napříč billingem, OAuth, knihovnami, cookies a testy.',
        'Nové testy pokrývají rate limiter, e-maily, CSV import, joby a scan API.',
      ],
      en: [
        'Type fixes landed across billing, OAuth, libraries, cookies, and tests.',
        'New tests cover the rate limiter, emails, CSV import, jobs, and scan API.',
      ],
    },
  },
  {
    date: '2026-04-27',
    title: {
      cs: 'Bezpečnější knihovny a member management',
      en: 'Safer libraries and member management',
    },
    summary: {
      cs: 'Dotažení izolace knihoven a přesnějších status kódů pro sdílené knihovny.',
      en: 'Library isolation and shared-library status codes were tightened up.',
    },
    changed: {
      cs: [
        'ISBN unikátnost je vyhodnocovaná per knihovna.',
        'Member-management testy lépe pokrývají očekávané chybové stavy.',
      ],
      en: [
        'ISBN uniqueness is now scoped per library.',
        'Member-management tests cover expected error states more clearly.',
      ],
    },
    fixed: {
      cs: [
        'Cizí X-Library-Id už nepadá do tichého fallbacku a vrací 403.',
        'Unauthenticated onboarding vrací konzistentně 401.',
      ],
      en: [
        'Foreign X-Library-Id no longer silently falls back and returns 403 instead.',
        'Unauthenticated onboarding now consistently returns 401.',
      ],
    },
  },
  {
    date: '2026-04-10',
    title: {
      cs: 'Password reset a auth hardening',
      en: 'Password reset and auth hardening',
    },
    summary: {
      cs: 'Přibyl reset hesla a několik bezpečnostních úprav kolem autentizace.',
      en: 'Password reset shipped together with several authentication hardening improvements.',
    },
    added: {
      cs: [
        'Forgot/reset password flow pro uživatele.',
        'Transakční e-maily pro reset hesla.',
      ],
      en: [
        'Forgot/reset password flow for users.',
        'Transactional password-reset emails.',
      ],
    },
    fixed: {
      cs: [
        'Lepší rate limiting a robustnější testy auth flow.',
      ],
      en: [
        'Improved rate limiting and more robust auth-flow tests.',
      ],
    },
  },
]
