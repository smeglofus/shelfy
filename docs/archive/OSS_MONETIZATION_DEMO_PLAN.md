# Shelfy — OSS + Monetization + Public Demo Plan (draft)

Date: 2026-04-03
Owner: Paťas
Status: park for later

## 1) Licensing / model

Recommended default: **open-core**.

- Core repository: consider `AGPL-3.0` (stronger anti-hosted-clone protection) or `Apache-2.0` (easier adoption).
- Paid/commercial differentiators in private modules/services.

Decision note:
- If priority is monetization protection -> AGPL-3.0.
- If priority is maximum community adoption -> Apache-2.0.

## 2) What stays OSS vs paid

### OSS core
- Book CRUD
- Shelf/location management
- Basic scan flow
- Digital twin
- Basic search/filter

### Paid / hosted
- Managed hosting + SLA
- Multi-user teams + roles
- Advanced backup/restore + scheduled exports
- Premium analytics/insights
- Priority support
- Premium integrations

## 3) Public demo architecture

Goal: live public demo in 24-48h.

Suggested stack:
- Frontend: Vercel (or Netlify)
- Backend + worker: Railway (or Render/Fly.io)
- Postgres + Redis: managed on the same platform
- Object storage: S3-compatible (R2/S3/MinIO managed)

Note: Netlify alone is not enough (Shelfy is not frontend-only).

## 4) Demo guardrails (must-have)

- Demo tenant / sandbox account
- Periodic data reset (cron)
- Rate limit expensive endpoints (scan/OCR)
- Clear banner: public demo + data may reset
- Optional: limit destructive bulk actions in demo mode

## 5) Go-to-market starter

Landing page essentials:
- one-line value proposition
- short GIF/video
- CTA: Try Live Demo
- CTA: Self-host (GitHub)
- pricing teaser / waitlist

Initial channels:
- niche communities (book lovers/self-hosting)
- build-in-public posts
- Product Hunt after stability

## 6) 30-day execution sketch

Week 1:
- choose license
- add OSS hygiene docs (LICENSE, CONTRIBUTING, SECURITY)
- sanitize secrets/demo creds

Week 2:
- deploy public demo
- add reset + rate limits + banner

Week 3:
- collect activation metrics
- open feedback loop

Week 4:
- launch Pro waitlist
- define first paid differentiators

## 7) Next concrete tasks when resumed

1. Final license decision (AGPL vs Apache)
2. Prepare legal/compliance baseline for external APIs
3. Implement demo mode flag + reset workflow
4. Create deploy checklist for Vercel + Railway
5. Draft pricing page copy and tiers
