export type ChangelogEntry = {
  date: string
  title: string
  summary: string
  added?: string[]
  changed?: string[]
  fixed?: string[]
}

export const changelogEntries: ChangelogEntry[] = [
  {
    date: '2026-04-29',
    title: 'Spolehlivější backend a přísnější CI',
    summary: 'Zpřísnili jsme backend quality gate: test coverage je zpět na 80 % a strict Mypy už není jen advisory kontrola.',
    changed: [
      'Backend test coverage gate je zvýšený zpět na 80 %.',
      'Strict Mypy běží jako povinná kontrola v CI.',
    ],
    fixed: [
      'Doplněné typové opravy napříč billingem, OAuth, knihovnami, cookies a testy.',
      'Nové testy pokrývají rate limiter, e-maily, CSV import, joby a scan API.',
    ],
  },
  {
    date: '2026-04-27',
    title: 'Bezpečnější knihovny a member management',
    summary: 'Dotažení izolace knihoven a přesnějších status kódů pro sdílené knihovny.',
    changed: [
      'ISBN unikátnost je vyhodnocovaná per knihovna.',
      'Member-management testy lépe pokrývají očekávané chybové stavy.',
    ],
    fixed: [
      'Cizí X-Library-Id už nepadá do tichého fallbacku a vrací 403.',
      'Unauthenticated onboarding vrací konzistentně 401.',
    ],
  },
  {
    date: '2026-04-10',
    title: 'Password reset a auth hardening',
    summary: 'Přibyl reset hesla a několik bezpečnostních úprav kolem autentizace.',
    added: [
      'Forgot/reset password flow pro uživatele.',
      'Transakční e-maily pro reset hesla.',
    ],
    fixed: [
      'Lepší rate limiting a robustnější testy auth flow.',
    ],
  },
]
