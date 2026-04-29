# Transactional email (Resend) — setup & operations

Shelfy sends transactional email through [Resend](https://resend.com).  Mail
flows from two places:

| Sender | Path | Triggers |
|---|---|---|
| `backend/app/services/email.py` | FastAPI request handlers | `send_welcome` (registration), `send_password_reset` (forgot-password) |
| `worker/email_tasks.py` | Celery beat | `send_trial_ending` (day 10/13), `send_limit_approaching` (≥ 80 % of free quota) |

Both call the Resend HTTP API at `https://api.resend.com/emails`.  When
`RESEND_API_KEY` is unset both modules **silently no-op** so local dev and CI
work without a real key.

## Sender identity

The default identity is:

```
From:     Shelfy <noreply@shelfy.cz>
Reply-To: support@shelfy.cz
```

Set per environment via:

| Env var | Default | Notes |
|---|---|---|
| `RESEND_API_KEY` | _(none)_ | `re_…` from [resend.com/api-keys](https://resend.com/api-keys); never commit, never log. |
| `EMAIL_FROM_ADDRESS` | `Shelfy <noreply@shelfy.cz>` | Must be a sender on a Resend-verified domain. |
| `EMAIL_REPLY_TO_ADDRESS` | `support@shelfy.cz` | Empty / unset → no `Reply-To` header. |

## DNS prerequisites (one-time, per domain)

Before mail will deliver from `shelfy.cz`:

1. In Resend: **Domains → Add domain → `shelfy.cz`**.
2. Add the records Resend lists at the registrar (Wedos):
   - `_resend.shelfy.cz` TXT (domain verification)
   - `resend._domainkey.shelfy.cz` TXT (DKIM)
   - `_dmarc.shelfy.cz` TXT (DMARC, recommend `p=none` initially, tighten to
     `p=quarantine` once delivery is stable)
   - SPF: ensure `v=spf1 include:_spf.resend.com ~all` is on the `shelfy.cz`
     TXT record (merge with any existing SPF — only one SPF record allowed).
3. Wait for Resend to mark the domain ✅ verified (usually < 10 min).

The Wedos mailboxes (`admin@`, `billing@`, `noreply@`, `support@`) are
**inbox-side** — they receive replies / bounces but do not change Resend's
sending verification.  `support@shelfy.cz` is configured to forward to a
real ops mailbox at Wedos.

## Local development

```bash
# .env (gitignored — never commit)
RESEND_API_KEY=re_…
EMAIL_FROM_ADDRESS=Shelfy <noreply@shelfy.cz>
EMAIL_REPLY_TO_ADDRESS=support@shelfy.cz
```

Smoke-test the password-reset path:

```bash
curl -X POST http://localhost:8000/api/v1/auth/password-reset/request \
  -H 'Content-Type: application/json' \
  -d '{"email": "you@your-real-inbox.example"}'
```

Backend logs should show `email.sent status=200` (or `email.failed` with the
HTTP error if Resend rejects).

## Production deployment

`RESEND_API_KEY` lives in the deployment secret store (`docker secret`,
GitHub Actions environment secret, or `--env-file` chmod-600).  It must
**not** appear in:

- the git index (`.env` and `infra/.env.prod.local` are gitignored)
- application logs (`_send` only logs `to`, `subject`, `status` — see the
  defence-in-depth test `test_send_does_not_log_authorization_header_on_failure`)
- the frontend bundle (`RESEND_API_KEY` is server-only; no `VITE_` mirror)

## Rotation

1. Resend dashboard → **API keys → Create new** (mark `Sending access` only).
2. Update the production secret store; redeploy backend + worker.
3. Confirm a `email.sent` log line appears with the new key in production.
4. Resend dashboard → **delete the old key**.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `email.failed` with HTTP 403 | Domain not verified in Resend, or `EMAIL_FROM_ADDRESS` not on the verified domain. |
| `email.failed` with HTTP 422 | Malformed `from`/`reply_to` (Resend rejects bare addresses without display names sometimes — keep `Name <addr@domain>` form). |
| `email.skipped (no RESEND_API_KEY)` in dev | Expected — set the key in `.env` to enable. |
| Replies bounce at Wedos | Check `support@shelfy.cz` mailbox / forwarder still exists at Wedos. |
