# ADR 008: Keep `Loan.borrower_name` / `Loan.borrower_contact` as denormalized columns

- **Status:** Accepted
- **Date:** 2026-05-07

## Context

The Borrowers epic (#221) introduced first-class `Borrower` records and a
nullable `Loan.borrower_id` foreign key in phase 1 (#222). Phase 6 (#227) is
the explicit decision point: now that the `Borrower`-based flow is fully
wired (loan picker #224, overview/detail pages #225, anonymization #226), do
we keep, deprecate, or remove the legacy text columns?

The columns:

| Column                   | Type                | Nullable |
|--------------------------|---------------------|----------|
| `loans.borrower_name`    | `String(255)`       | NO       |
| `loans.borrower_contact` | `String(255)`       | YES      |

### Audit — what reads / writes these columns today

**Backend** (current `main`, post-#226):

| Site                                              | Behavior                                                                     |
|---------------------------------------------------|------------------------------------------------------------------------------|
| `app/models/loan.py`                              | Column definitions; `borrower_name` is `nullable=False`.                     |
| `app/schemas/loan.py` (`LoanCreate`)              | Accepts either `borrower_id` *or* `borrower_name` + `borrower_contact`.      |
| `app/schemas/loan.py` (`LoanResponse`)            | Always returns both, plus the nested `borrower: BorrowerResponse \| None`.   |
| `app/services/loan_service.create_loan`           | When `borrower_id` is given, copies `borrower.name`/`borrower.contact` into the legacy columns; with `borrower_name` only, writes the typed text and leaves `borrower_id` NULL. |
| `app/services/borrower.link_loans_to_borrowers`   | One-shot backfill (#223): reads legacy columns to find/create a `Borrower` and sets `borrower_id`. |
| `app/services/borrower.anonymize_borrower`        | On anonymize, **cascades** the sentinel `"Deleted borrower"` into `borrower_name` and clears `borrower_contact` on every linked loan (#226). |
| `app/api/auth.py` (GDPR data export)              | Includes the two columns verbatim in the user data dump.                     |

**Frontend** (current `main`, post-#226):

| Site                                              | Behavior                                                                     |
|---------------------------------------------------|------------------------------------------------------------------------------|
| `lib/types.ts` (`Loan`)                           | Both columns + nested `borrower: Borrower \| null`.                          |
| `components/LoanHistory.tsx`                      | Renders `loan.borrower_name` directly. **Does not** prefer `loan.borrower?.name`. |
| `components/LendBookModal.tsx`                    | Sends legacy columns only as the new-borrower fallback (#224).               |

The phase-6 issue's stated precondition was *"No frontend code depends on
`borrower_name` as the primary source"*. **That precondition is currently
unmet** — `LoanHistory` is still primary-source. This is mostly invisible
because `create_loan` keeps the legacy columns in sync with the borrower
record, but it has one user-visible consequence: when a Czech user views the
loan history of an anonymized borrower, they see the English DB sentinel
`"Deleted borrower"` instead of the localized label `"Smazaný dlužník"`.
There is no way to localize from the loan-row alone, because nothing on the
row tells us the borrower has been anonymized.

## Options considered

**Option A — Keep permanently as denormalized display fallback.** The legacy
columns become a deliberate, supported snapshot.

**Option B — Mark deprecated but keep in DB.** Same DB shape; we communicate
the direction. Practically indistinguishable from A unless we also stop
writing to them, which would break the GDPR export and the anonymization
cascade.

**Option C — Remove the columns in a later migration.** Single source of
truth (the `Borrower` row). Lots of churn — `LoanCreate` loses the typed-name
flow, `create_loan` and the anonymization cascade simplify, every loan
read-path needs an eager join.

## Decision

**Option A — keep the columns. Treat them as a deliberate denormalization.**

### Why not C

- The "type a name to lend" flow (`LoanCreate.borrower_name` without
  `borrower_id`) is real, simple, and used. Removing it forces "create a
  borrower record first" on the lender, which is the kind of friction phase
  4 explicitly avoided ("Do not make lending slower or more complex").
- The `create_loan` path that copies `borrower.name`/`contact` into the loan
  is what guarantees old loan history stays readable even if the `Borrower`
  row is later anonymized — and what makes the anonymization cascade actually
  reach loan rows. Both behaviors disappear if the columns disappear, and
  must be reimplemented as eager joins everywhere.
- A `Borrower` row's lifecycle can outlive its meaningful identity (anonymize
  in #226). Loan rows are an archival record; freezing the borrower text on
  the loan when it was lent matches that archival semantic.
- Removing requires a non-trivial Alembic migration on a NOT NULL column on
  every existing installation, plus a write-time guarantee that `borrower_id`
  is always present going forward — a separate breaking change to the public
  `LoanCreate` shape.

### Why not B

Pure deprecation without removal is what we already do informally; making it
"official" without changing behavior buys nothing. The columns are in active
use (anonymization cascade, GDPR export, simple lend flow), so calling them
deprecated would be misleading.

### What this decision implies

1. The columns are part of the schema's stable surface. New code that touches
   loans should keep writing them; treat them as a snapshot of the borrower's
   identity at the time of lending.
2. `Loan.borrower_name` stays `NOT NULL`. The sentinel `"Deleted borrower"`
   from `app.services.borrower.ANONYMIZED_BORROWER_NAME` is the correct value
   when the borrower is anonymized.
3. Anything that **displays** loan rows should prefer the nested
   `loan.borrower` over the loan-level columns when it exists, so that
   anonymized records get a localized label, contact updates flow through,
   etc. The legacy columns are the **fallback** for the case where
   `borrower_id` is `NULL` (typed-name lend, pre-Borrower history that
   couldn't be backfilled).
4. The GDPR export keeps including the legacy columns — they are the
   archival record of who borrowed what at the time it happened.

### Code changes that follow from this decision

This ADR is shipped alongside two small changes that align the codebase with
the decision:

- `LoanHistory.tsx` is refactored to read from `loan.borrower` first and only
  fall through to `loan.borrower_name` / `loan.borrower_contact` when the
  borrower link is absent. The localized "Deleted borrower" label now reaches
  the loan history page for anonymized borrowers.
- `app/models/loan.py` gets a docstring explaining that the two columns are
  a denormalized snapshot and pointing here.

No schema migration. No public API change. OpenAPI is unchanged.

## Consequences

- Drift risk between `loan.borrower_name` and `loan.borrower.name` is
  bounded: `create_loan` writes both at insert time, and the anonymization
  cascade in #226 is the only post-insert mutation that touches both. We do
  not, by design, propagate edits to a `Borrower` (e.g. `PATCH
  /borrowers/{id}` with a new name) into already-existing loans — that is
  the archival semantic above.
- "Update a borrower's contact, want it shown on past loans" is *not*
  supported by design. If a librarian wants the new contact on existing
  loans, they should re-display via the borrower detail page (#225), where
  the data comes from the `Borrower` row directly.
- A future ADR can revisit removal once the typed-name flow is genuinely
  unused (e.g. if onboarding required selecting a borrower record). At that
  point, the migration is comparatively cheap because anonymization and the
  GDPR export are the only producers left.

## Testing

This ADR carries no behavior change beyond the `LoanHistory` refactor, which
is covered by the existing borrower-anonymization tests (`#226`,
`backend/tests/test_borrower_anonymize.py`) plus a frontend test in
`components/LoanHistory.test.tsx` that asserts:

- The loan row prefers `loan.borrower.name` when present.
- The localized "Deleted borrower" label is shown when
  `loan.borrower.anonymized_at` is set, regardless of the legacy column
  value.
- Falls back to `loan.borrower_name` when `loan.borrower` is `null` (legacy
  loan that #223 couldn't backfill).

## 2026-05-07 — Amendment: borrower merge keeps loan snapshots untouched

Phase 6 (#238) introduced a "merge two duplicate borrowers" action. The
implementation question was whether merging the source borrower into the
target should also rewrite `loan.borrower_name` / `loan.borrower_contact`
on the moved loan rows to match the target's identity.

**Decision:** No. Loan snapshots are *not* rewritten on merge. The merge
re-points `Loan.borrower_id` from source to target and deletes the source
row; the snapshot columns keep recording who the borrower was *at lend
time*, which may differ from the post-merge identity.

This is the same archival semantic as the rest of this ADR. The display
layer already prefers `loan.borrower.name` via the relationship (see the
`LoanHistory` refactor above), so a Czech user looking at the merged
loan history sees the target's current name on every row, even though
the underlying snapshot column records the older variant. We get
correct UX *and* a faithful archival record, with no DB rewrite.

The exception that proves the rule is anonymization (#226), which
*does* cascade to the snapshot columns — because anonymization's whole
point is to erase the personal data those columns hold. Merge does not
have that requirement, so the simpler "leave snapshots alone" rule is
the right default here.

Implementation lives in `backend/app/services/borrower.merge_borrowers`;
the cascade-vs-snapshot behavior is asserted in
`tests/test_borrower_merge.py::test_merge_does_not_update_loan_snapshots`.

## 2026-05-12 — Amendment: actor-audit columns on borrowers

Phase-6 follow-up (#245) added three nullable user-FK columns to
`borrowers` so identity-touching mutations record *who* performed them,
not just *when*: `created_by_user_id`, `anonymized_by_user_id`,
`merged_into_by_user_id`. Each is `ondelete=SET NULL` so deleting the
acting user does not cascade-delete the borrower record.

**Where each one is set:**

| Mutation                              | Stamps                            |
|---------------------------------------|-----------------------------------|
| `create_borrower`                     | `created_by_user_id`              |
| `anonymize_borrower`                  | `anonymized_by_user_id`           |
| `bulk_anonymize_borrowers`            | `anonymized_by_user_id` (per row) |
| `merge_borrowers` (on target)         | `merged_into_by_user_id`          |
| `update_borrower`                     | none (deliberate — high-frequency, low audit value; can graduate later) |

**Where it is *not* recorded:**

- The source row in a merge is deleted, so there's no place to put a
  "merged-from-by". The action is recorded on the surviving target as
  "I absorbed another record into me." See
  `test_borrower_audit.py::test_merged_into_by_user_id_is_stamped_only_on_target`.
- Edits via `PATCH /api/v1/borrowers/{id}` (the Edit modal) do not record
  the editor. If a real audit need shows up there, add an
  `updated_by_user_id` column in a follow-up — the columns are FK-typed
  the same way, so the migration is one line per addition.

**Frontend status:** the new fields are exposed on `BorrowerResponse` and
typed on the frontend `Borrower` interface. No UI surfaces them yet — a
user-friendly footer ("Anonymized by alice@example.com on …") needs a
user-resolver endpoint we don't currently expose. Filed as a follow-up.

Tests pinning the contract: `backend/tests/test_borrower_audit.py`.

---

## 2026-05-18 — Amendment: pending-anonymization soft delete (#244)

**Decision:** `POST /api/v1/borrowers/{id}/anonymize` no longer wipes PII
synchronously by default. The default contract is now *scheduled* —
sets `pending_anonymization_until = now() + 30 days` and stamps
`anonymized_by_user_id`. PII stays intact for the window so a misclick
is recoverable via `POST /restore`. A periodic worker
(`finalize_pending_anonymizations`, every 30 min via Celery beat)
finalizes rows once their deadline has passed.

The legacy hard-anonymize path stays reachable as an explicit opt-in:
`POST /anonymize?immediate=true`. This is the DSAR / "data-subject
requested erasure" escape hatch — privacy laws sometimes require an
immediate wipe and we should not force a 30-day delay on those.

**Key semantic correction (carried over from review):** reversible
anonymization is *not* anonymization. While the pending window is open,
the row still contains PII. The schema reflects this — `anonymized_at`
is only set when the worker finalizes; the pending state is its own
column. Audit footers / GDPR exports must treat
`pending_anonymization_until is not null AND anonymized_at is null` as
"scheduled, not yet anonymized."

**Schema (migration `20260518_000023`):**

- `borrowers.pending_anonymization_until: timestamp NULL, indexed`.
  Indexed because the worker scans for `WHERE … < now() AND
  anonymized_at IS NULL` every 30 min.

**State transitions:**

| State                   | `anonymized_at` | `pending_anonymization_until` |
|-------------------------|-----------------|-------------------------------|
| active                  | NULL            | NULL                          |
| pending_anonymization   | NULL            | future timestamp              |
| anonymized (terminal)   | past timestamp  | NULL                          |

Transitions:

- active → pending_anonymization: `POST /anonymize` (default mode)
- active → anonymized: `POST /anonymize?immediate=true` (DSAR)
- pending_anonymization → anonymized: worker, or
  `POST /anonymize?immediate=true` (upgrade in place)
- pending_anonymization → active: `POST /restore`
- anonymized → anything: not allowed (422 from `/restore`)

**Idempotency rules:** double-scheduling preserves the original
deadline; the API does not extend the window on a second click.
Re-anonymizing a finalized borrower is a no-op (returns the existing
row).

**Worker:** `worker/borrower_maintenance_tasks.py`. Uses raw psycopg2
(matches `email_tasks.py` convention) and `SELECT … FOR UPDATE SKIP
LOCKED` so concurrent beat fires never double-process the same row.
Batched (100/run). Cascade clears denormalized borrower text on loan
rows during finalization — same contract as the immediate path.

**Retention bulk (#246) interaction:** the retention bulk anonymize
now defaults to the pending state too. Librarians get a 30-day window
to spot false positives in the retention report and restore them. The
`?immediate=true` query param is also available on the retention bulk
endpoint.

**Out of scope for this amendment:**

- Merge undo. Same rationale (recover from misclicks) but the
  implementation needs a different shape (snapshot + 10s undo log
  table) — filed as a follow-up PR.
- Countdown timer on the pending badge + dedicated "Recently
  anonymized" filter on the borrowers list view. Separate FE polish PR.

Tests pinning the contract:
`backend/tests/test_borrower_pending_anonymize.py` (lifecycle + worker)
plus updated `test_borrower_anonymize.py` (legacy immediate semantics
now sit behind `?immediate=true`).
