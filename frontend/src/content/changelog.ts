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
    date: '2026-05-06',
    title: {
      cs: 'Knihovna ukázek, onboarding a sidebar',
      en: 'Sample library, onboarding, and sidebar',
    },
    summary: {
      cs: 'Novým uživatelům se založí ukázková knihovna. Přibyl sidebar s přehledem plánu a onboarding je teď přívětivější.',
      en: 'New users now get a sample library. A sidebar with plan overview shipped, and onboarding is now friendlier.',
    },
    added: {
      cs: [
        'Ukázková knihovna při registraci s možností ji odstranit (#202).',
        'Onboarding nahrazen akčním pickerem místo krokového wizardu (#203).',
        'Sidebar s indikátorem plánu, progress bary a CTA pro upgrade (#205).',
        'Vylepšené prázdné stavy napříč stránkami (#204).',
        'Admin CLI pro ruční nastavení subscription plánu.',
      ],
      en: [
        'Sample library seeded on registration with clear banner option (#202).',
        'Onboarding replaced with action picker instead of step wizard (#203).',
        'Sidebar with plan indicator, progress bars, and upgrade CTA (#205).',
        'Improved empty states across pages (#204).',
        'Admin CLI for manually granting subscription plans.',
      ],
    },
    changed: {
      cs: [
        'Landing page — přidány rychlé odkazy na Funkce a Ceník do navigace.',
      ],
      en: [
        'Landing page — added Features and Pricing quick links to top nav.',
      ],
    },
  },
  {
    date: '2026-05-04',
    title: {
      cs: 'Výkon, zálohy a automatický deploy',
      en: 'Performance, backups, and automated deploy',
    },
    summary: {
      cs: 'Opravili jsme pád při velkých knihovnách, přidali ETag caching a zautomatizovali zálohy i nasazování.',
      en: 'We fixed a crash on large libraries, added ETag caching, and automated both backups and deployments.',
    },
    added: {
      cs: [
        'Automatické zálohy databáze a souborů (#182).',
        'GitHub Actions deploy workflow pro produkci (#195, #197).',
        'SEO, sitemap, robots.txt a disaster recovery runbook (#183).',
      ],
      en: [
        'Automated database and file storage backups (#182).',
        'GitHub Actions deploy workflow for production (#195, #197).',
        'SEO, sitemap, robots.txt, and disaster recovery runbook (#183).',
      ],
    },
    fixed: {
      cs: [
        'Pád stránky Books při 5k+ knihách — přepnuto na stránkované dotazy (#206).',
        'Výkon Bookshelf — ETag caching a content-visibility (#209, #210).',
        'Scrollování na knihu v Bookshelf (#211, #212).',
        'Stabilita E2E testů — zavírání onboarding modalu, Bearer tokeny (#208).',
      ],
      en: [
        'Books page OOM crash at 5k+ books — switched to paginated queries (#206).',
        'Bookshelf performance — ETag caching and content-visibility (#209, #210).',
        'Bookshelf scroll-to-book reliability (#211, #212).',
        'E2E test stability — onboarding modal dismissal, Bearer tokens (#208).',
      ],
    },
  },
  {
    date: '2026-04-30',
    title: {
      cs: 'Lokalizované e-maily, scan a landing',
      en: 'Localized emails, scan, and landing',
    },
    summary: {
      cs: 'Přibyla lokalizace transakčních e-mailů, možnost přeuspořádat knihy ve scanu a vylepšení landing page.',
      en: 'Transactional emails are now localized, scan supports reordering books, and the landing page got a trust upgrade.',
    },
    added: {
      cs: [
        'Lokalizované transakční e-maily (CS/EN) podle jazyka účtu (#173, #175).',
        'Vkládání a přeuspořádání knih ve scanu před uložením (#116, #176).',
        'Landing page — sekce Pro koho je Shelfy a důvěryhodnostní prvky (#143, #146, #179).',
      ],
      en: [
        'Localized transactional emails (CS/EN) based on account locale (#173, #175).',
        'Insert and reorder book cards in scan before saving (#116, #176).',
        'Landing page — audience sections and trust signals (#143, #146, #179).',
      ],
    },
    fixed: {
      cs: [
        'E2E auth refresh po reloadu protected routes (#177).',
      ],
      en: [
        'E2E auth refresh after protected route reloads (#177).',
      ],
    },
  },
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
