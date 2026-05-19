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
    date: '2026-05-19',
    title: {
      cs: 'Vratná anonymizace a undo pro sloučení dlužníků',
      en: 'Reversible anonymization and merge undo for borrowers',
    },
    summary: {
      cs: 'Anonymizace dlužníka se teď dá do 30 dnů vrátit zpět, sloučení duplicit má 10vteřinové undo. Plus drobné UX vylepšení vybírání dlužníka v půjčce.',
      en: 'Borrower anonymization is now reversible for 30 days, merging duplicates has a 10-second undo. Plus small UX upgrades to the borrower picker in the lend modal.',
    },
    added: {
      cs: [
        'Anonymizace dlužníka je teď ve výchozím režimu plánovaná na 30 dnů — během této doby se dá kdykoli vrátit tlačítkem „Vrátit". Po vypršení dlužníka tichý worker dokončí anonymizaci jako dřív (#244).',
        'Pro žádost subjektu o smazání (GDPR/DSAR) zůstává okamžitý režim přístupný přes zaškrtávátko v potvrzovacím dialogu (#244).',
        'Žlutý štítek „Plánovaná anonymizace" s odpočtem (dny + hodiny) na detailu dlužníka, aby bylo jasné, kolik času na vrácení ještě zbývá (#244).',
        'Filtr „Plánovaná anonymizace" na stránce /borrowers, abys našel(a) dlužníky čekající na smazání bez znalosti URL (#244).',
        'Sloučení dvou dlužníků je teď reverzibilní 10 vteřin — po potvrzení se objeví toast s tlačítkem „Vrátit (Xs)". Klik obnoví zdrojový záznam i jeho půjčky (#244).',
        'Patička auditu na detailu dlužníka: ukazuje, kdo dlužníka vytvořil / anonymizoval / sloučil a kdy (#261).',
        'Disambiguace v dialogu Půjčit knihu: když existují dva dlužníci se stejným jménem, místo tichého duplikátu se zobrazí inline panel s výběrem konkrétního záznamu (#250).',
        'Půjčování knihy v knihovně se 100+ dlužníky teď dohledá existující záznam přes server-side hledání místo prvních 100 řádků (#250).',
      ],
      en: [
        'Borrower anonymization now defaults to a 30-day scheduled mode — you can hit "Restore" any time during the window. After it expires, a quiet worker finishes the wipe exactly like before (#244).',
        'For GDPR data-subject erasure requests the immediate mode stays available via a checkbox in the confirmation dialog (#244).',
        'Yellow "Anonymization scheduled" badge with a live countdown (days + hours) on the borrower detail page, so the remaining grace window is visible at a glance (#244).',
        '"Scheduled for deletion" filter on the /borrowers page — find pending borrowers without knowing their URL (#244).',
        'Merging two borrowers is now reversible for 10 seconds — after confirming, a toast with "Undo (Xs)" surfaces. Clicking restores the source record and re-points its loans (#244).',
        'Audit footer on the borrower detail page showing who created / anonymized / merged the record, and when (#261).',
        'Disambiguation in the Lend book dialog: when two borrowers share a name, an inline panel surfaces both so you can pick the right record instead of silently creating a duplicate (#250).',
        'Lending in a library with 100+ borrowers now finds the existing record via server-side search rather than just the first page of rows (#250).',
      ],
    },
    changed: {
      cs: [
        'Potvrzovací dialog při sloučení dvou dlužníků už neříká „nelze vrátit" — místo toho vysvětluje, že akce je 10 vteřin vratná (#244).',
      ],
      en: [
        'Merge confirmation dialog no longer says "this cannot be undone" — it now explains the 10-second undo window (#244).',
      ],
    },
    fixed: {
      cs: [
        'Plánované úlohy ve workeru (denní e-mailové připomínky, retence dat) hlásí výjimky do Sentry. Dříve tiše končily v logu a nikdo se o nich nedozvěděl.',
      ],
      en: [
        'Background worker tasks (daily email reminders, retention sweeps) now report exceptions to Sentry. Previously they failed silently in the log.',
      ],
    },
  },
  {
    date: '2026-05-07',
    title: {
      cs: 'Dlužníci jako samostatná entita',
      en: 'Borrowers as first-class objects',
    },
    summary: {
      cs: 'Půjčování má teď evidenci dlužníků s historií napříč knihami a bezpečnou anonymizací osobních údajů.',
      en: 'Lending now has a real borrower record with cross-book history and a safe way to wipe personal data.',
    },
    added: {
      cs: [
        'Stránka /borrowers s vyhledáváním a statistikami (počet aktivních, celkem, poslední aktivita); hledání i stránkování běží na serveru (#225, #237).',
        'Detail dlužníka se sekcemi Aktuálně půjčeno a Vráceno, včetně stavu při vrácení (#225).',
        'Picker existujících dlužníků ve formuláři půjčení knihy s nepovinným ručním zápisem (#224).',
        'Úprava údajů dlužníka (jméno, kontakt, poznámky) z detailu (#236).',
        'Anonymizace dlužníka — smaže jméno/kontakt/poznámky a všechny identifikující údaje na jeho půjčkách, historie zůstává (#226).',
        'Sloučení dvou duplicitních záznamů dlužníka do jednoho — historie půjček se konsoliduje (#238).',
        'Záložka Dlužníci v mobilní spodní navigaci (#236).',
      ],
      en: [
        '/borrowers page with search and per-row stats (active, total, last activity); search and pagination run server-side (#225, #237).',
        'Borrower detail page with Currently borrowed and Returned sections, including return condition (#225).',
        'Existing-borrower picker in the lend modal with a typed-name fallback (#224).',
        'Edit borrower (name, contact, notes) directly from the detail page (#236).',
        'Anonymize action — wipes name/contact/notes and clears identifying data on the borrower\'s loans while keeping history (#226).',
        'Merge two duplicate borrower records into one — lending history is consolidated (#238).',
        'Borrowers tab in the mobile bottom navigation (#236).',
      ],
    },
    changed: {
      cs: [
        'GDPR export osobních dat zahrnuje záznamy dlužníků z každé knihovny (#235).',
        'Historie půjček u knihy zobrazí lokalizovaný štítek „Smazaný dlužník" pro anonymizované záznamy (#227).',
      ],
      en: [
        'GDPR data export now includes the standalone borrower list per library (#235).',
        'Loan history on book pages shows a localized "Deleted borrower" label for anonymized records (#227).',
      ],
    },
  },
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
