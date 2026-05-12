# Privacy policy + Terms audit — 2026-05-12

Tracks the content audit asked for by issue #252 after the borrowers epic
(#221) shipped. The previous audit work in PR #258 only DRY-ified the
legal metadata into `lib/legal.ts`; the actual policy text was unchanged
and still missed the new data flows introduced by the borrower epic.

## What was checked

| Surface | Files |
|---|---|
| Privacy policy | `frontend/src/pages/PrivacyPage.tsx` |
| Terms of service | `frontend/src/pages/TermsPage.tsx` |
| Shared legal metadata | `frontend/src/lib/legal.ts` |

## Audit questions vs. resolution

| # | Question | Pre-audit answer | Action |
|---|---|---|---|
| 1 | Does the privacy policy describe borrowers as a distinct data category? | No — collapsed under "Data knihovny: výpůjčky" | Added explicit row in §2 with own legal basis. |
| 2 | Does it describe deletion / anonymization rights for borrower records? | No — only account deletion | §6 expanded: pointer to `/borrowers → Anonymize` for partial erasure, §5 retention table gets a "Údaje dlužníka" row. |
| 3 | Does it cover what `/auth/me/export` ships? | Generic "JSON export" — no mention of borrower records | §6 export bullet now names the borrower export contents. |
| 4 | Is the librarian's data-controller role for borrower data described? | No | New §11 "Údaje dlužníků: vztah správce/zpracovatel" — explicitly: librarian is the data controller, Shelfy is the processor. |
| 5 | Do the Terms reflect the same controller/processor split? | No | §8 expanded with the controller responsibility for librarian. |
| 6 | Are anonymization + merge semantics covered? | No | §5 + §6 + §11 of Privacy. |
| 7 | cs/en parity | Pages are cs-only by design; no en variant to keep in sync | No action. If en variant ever lands, mirror these sections. |

## Out of scope

- Formal legal review. Goal here is consistency with what the app actually
  does. Legal sign-off remains a separate workstream.
- Restructuring the page layouts or visual design. The audit is a content
  fix, not a redesign.
- Cookies / consent banner work.
- Backend changes — none required; the API surface that exists (anonymize
  endpoint, GDPR export) already supports what the policy now describes.

## Version bump

- `LEGAL_DOC_VERSION`: `2.0` → `2.1`
- `LEGAL_DOC_EFFECTIVE_DATE`: `8. dubna 2026` → `12. května 2026`

## Follow-ups not done in this audit

- en-language variants of the policy pages: still missing. File as a
  separate issue if/when the app gains an English landing.
- DPIA / record of processing activities (Art. 30 GDPR record): not part
  of the user-facing policy; tracked separately.
