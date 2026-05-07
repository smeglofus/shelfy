# Shelfy changelog

Public source for notable Shelfy changes. Keep entries short, dated, and user-facing; avoid implementation noise unless it affects reliability, security, privacy, or product behavior.

The public page at `/changelog` is generated from `frontend/src/content/changelog.ts`. When adding a release note, update both files in the same PR until a markdown-to-page generator exists.

## 2026-05-07 — Dlužníci jako samostatná entita

- Přibyla evidence dlužníků (`/borrowers`) s vyhledáváním a statistikami počtu půjček. Hledání i stránkování běží na serveru a fungují i ve velkých knihovnách (#225, #237).
- Detail dlužníka ukazuje aktuální půjčky i historii včetně stavu při vrácení (#225).
- Půjčování knihy umí vybrat existujícího dlužníka z našeptávače i ručně napsat nového (#224).
- Údaje dlužníka (jméno, kontakt, poznámky) jdou upravit přímo z detailu (#236).
- Anonymizace dlužníka bezpečně smaže osobní údaje napříč knihovnou i historií půjček (#226).
- Sloučení dvou duplicitních záznamů dlužníka do jednoho — historie půjček se konsoliduje (#238).
- GDPR export osobních dat zahrnuje záznamy dlužníků z každé knihovny (#235).
- Záložka Dlužníci v mobilní spodní navigaci.
- Loan history na stránce knihy zobrazí lokalizovaný štítek „Smazaný dlužník" / "Deleted borrower" pro anonymizované záznamy (#227).

## 2026-04-29 — Spolehlivější backend a přísnější CI

- Backend test coverage gate is back at 80%.
- Strict Mypy is now a required CI gate instead of advisory-only.
- Added/fixed type coverage across billing, OAuth, cookies, libraries, CSV import, scan API, and tests.

## 2026-04-27 — Bezpečnější knihovny a member management

- ISBN uniqueness is scoped per library.
- Foreign `X-Library-Id` returns 403 instead of silently falling back.
- Unauthenticated onboarding returns 401 consistently.

## 2026-04-10 — Password reset a auth hardening

- Added forgot/reset password flow.
- Added reset-password transactional e-mails.
- Improved auth rate-limiting and tests.
