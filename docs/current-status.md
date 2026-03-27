# Current Status

Last updated: 2026-03-27

## Completed Phases

| Phase | Description | Key PR(s) | Date |
|-------|------------|-----------|------|
| 0 | Planning | #1 | 2026-02 |
| 1 | Project skeleton + CI | #3 | 2026-02 |
| 2 | Auth (JWT) | #9 | 2026-02 |
| 3 | Locations backend | #11 | 2026-02 |
| 4 | Locations frontend | #13 | 2026-03 |
| 5 | Books backend | #15 | 2026-03 |
| 6 | Books frontend | #26 (initial), #72 (UI redesign) | 2026-03 |
| 7 | Image upload + job skeleton | #43 | 2026-03 |
| 8 | Barcode + Gemini Vision | #75 (superseded OCR with Gemini) | 2026-03 |
| 9 | External metadata providers | #51, #52 | 2026-03 |
| 10 | Observability | #54, #55 | 2026-03 |
| 11 | Hardening + polish | #57 | 2026-03-18 |
| 12 | Homelab deployment | #60 | 2026-03 |
| 13 | Gemini Vision spine recognition | #75 | 2026-03 |

## In Progress

Nothing active. All planned phases complete as of 2026-03-27.

## Known Issues

- reading_status + lent_to were missing from backend model/schemas after PR #96 merge conflict — restored in this PR
- CI backend tests were using SQLite instead of PostgreSQL — fixed in this PR
- Entity design doc (`docs/entity-design.md`) was missing `reading_status` and `lent_to` — now updated
- Branch naming in practice uses `feat/` and `fix/` prefixes, not `feature/` as originally documented — standard updated to match reality

## What's Next

See `docs/implementation-phases.md` and `docs/target-product-spec.md` for next priorities.
