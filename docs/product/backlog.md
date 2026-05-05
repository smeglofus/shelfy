# Shelfy — Product Improvement Backlog

> Living document. Created 2026-05-04 as a PM analysis of the current MVP state.
> Use this as the source of truth for product priorities; convert individual items to GitHub issues only when they enter active development.

---

## 1. Product diagnosis

### Biggest product risks right now

- **AI scan trust gap.** The shelf photo → AI extraction is the headline feature *and* the biggest place to lose users. One bad scan with wrong titles/authors and the user concludes "this doesn't work." There's no visible confidence model, no easy bulk-correct, no "rescan this one book" affordance.
- **Empty-state cliff.** A new account opens to an empty library with no sample data, no guided "add your first book in 30 seconds," no demo library to browse. The hero feature requires the user to physically stand in front of a bookshelf with their phone — high activation friction.
- **"Why come back?" is weak.** After the cataloging novelty wears off, returning-user value is thin: no reading stats, no overdue-loan reminders, no wishlist, no annual recap. Cataloging apps without retention loops become write-once databases.
- **Pricing readiness is mid.** 4 tiers exist but the free tier (100 books) covers most genuine home libraries — meaning the upgrade trigger is unclear. There's no trial, no in-flow upgrade nudges, and the value ladder between Home (1,000 books) and Pro (5,000 books + members) doesn't map cleanly to user need.
- **Czech-only TAM.** Solid i18n foundation but EN landing page hasn't been pressure-tested for international reach. Small home-library SaaS only works at scale.

### What is most likely blocking activation/retention

| Blocker | Symptom |
|---|---|
| No sample library / interactive demo | User signs up, sees zero books, doesn't know what "good" looks like |
| Scan failure mode is silent or rough | Low-quality scan results aren't easy to fix → trust collapses |
| No Goodreads/StoryGraph/CSV migration template | Power users (the people who pay) can't bring their existing collection |
| No notifications | Lent-out books, due dates, scan-completed — all invisible after the user closes the tab |
| No share/public profile UX | Book people love showing collections; this is free virality being left on the table |
| Unclear upgrade triggers | Soft limits not surfaced contextually ("you've used 8/10 scans this month") |

---

## 2. Improvement backlog

| # | Title | Problem | Improvement | Impact | Effort | Area | Why now |
|---|---|---|---|---|---|---|---|
| 1 | Sample library on signup | Empty state kills activation | Seed 15–20 demo books across 2 shelves with cover, status, one lent example. "Clear sample" button. | High | S | Activation | First-impression dictates everything |
| 2 | First-book guided flow | User doesn't know whether to scan, search, or type | Post-signup modal: "Add your first book — Scan a shelf · ISBN · Search · CSV import" with 30-sec preview videos | High | S | Activation | Removes the "now what?" beat |
| 3 | Scan review screen v2 | Wrong titles destroy trust | Show confidence per book (color-coded), one-tap "fix this", "remove this", batch accept/reject; allow re-OCR a single spine | High | M | Trust | The hero feature must feel reliable |
| 4 | Scan tips & coach | Bad photo → bad scan, no feedback | Pre-capture overlay: lighting check, "stand 1m back," tilt warning. Post-capture: "low light detected, try again?" | High | S | Trust | Most scan failures are bad input |
| 5 | Goodreads CSV import | Power users can't migrate | Goodreads export → mapped fields (date read, rating, shelves → status). Show preview, dedup. | High | M | Activation | This is the #1 unlock for serious readers |
| 6 | ISBN scan via phone camera | Only spine-photo and manual today | Single-book ISBN barcode mode (faster, more reliable than spine OCR for one book) | High | M | UX | Standard expectation; closes a key flow gap |
| 7 | Usage meters in UI | Free users don't see why to upgrade | Sidebar: "8/10 scans · 47/100 books." Tooltip when nearing limit. | High | S | Monetization | Upgrade prompts only work if limits are visible |
| 8 | Contextual upgrade prompts | No in-flow nudges | When user hits 10/10 scans: modal with "Upgrade to Home — 50/mo for 59 Kč" + one-click | High | S | Monetization | Catch intent at peak moment |
| 9 | Public library page | Sharing infra exists but no UI | `shelfy.cz/u/janek` read-only library, opt-in. Share button on library settings. | High | M | Retention | Free virality + status driver |
| 10 | Loan reminders (email) | Lent books are forgotten | T-3 day, due-date, T+7 overdue email. Optional borrower email. | High | M | Retention | Single most-asked feature in this category |
| 11 | "Rescan one spine" | Single bad book in a good scan = full redo | In review, tap-and-hold a book → camera opens for that one spine | Medium | S | Trust | Reduces frustration meaningfully |
| 12 | Reading status filters as chips | Hidden behind filter UI | Surface "Reading now (3) · Want to read (12) · Lent (2)" as top-level tabs | Medium | S | Retention | Re-engagement hooks |
| 13 | Wishlist / Want-to-read | No "books I don't own yet" concept | Add "wishlist" status (doesn't count toward book limit on Free) | Medium | S | Retention | Returning-user reason; pre-purchase planning |
| 14 | Annual reading recap | No yearly value moment | Dec/Jan email + page: "You read 23 books in 2026, longest book was X, etc." | Medium | M | Retention | Spotify-wrapped style sharing → virality |
| 15 | Tags / collections | No flexible grouping | Free-form tags on books; saved tag views | Medium | M | UX | Power users hit this wall fast |
| 16 | Bulk actions on book list | Editing 50 books one-by-one | Multi-select → set status, location, tag, delete | Medium | M | UX | Cleanup workflows |
| 17 | OAuth login (Google) | Email/password = friction | Wire the existing callback to Google login on landing | Medium | S | Activation | Drops signup friction 30–40% in this category |
| 18 | Empty-state CTAs per page | Empty `/books`, `/locations` are bare | "Scan your first shelf" hero with illustration on each empty page | Medium | S | Activation | Cheap polish with high effect |
| 19 | Trial mode for paid plans | No risk-free try | 14-day Pro trial without card; auto-downgrade | Medium | S | Monetization | Lifts paid conversion, especially for "Library" plan |
| 20 | Plan comparison clarity | 4 tiers blur together | Clear job-to-be-done labels: "For one bookshelf", "For your home library", "For book clubs", "For small libraries" | Medium | S | Monetization | Helps user self-select |
| 21 | PWA install prompt | App-like UX exists but uninstalled | Smart install banner after 2nd visit; iOS instructions | Medium | S | Retention | Phone home-screen icon = 5x return rate |
| 22 | Scan progress notification | User scans, navigates away, doesn't know it's done | Web push (or in-app toast on return) "Scan complete: 24 books found" | Medium | S | UX | Async feature feels broken without it |
| 23 | Borrower mini-CRM | Borrowers re-typed every loan | Auto-suggest borrowers from history; basic borrower page | Low | S | UX | Quality-of-life for active lenders |
| 24 | Library export (CSV/PDF) | Trust: "is my data locked in?" | One-click CSV export; printable PDF inventory | Medium | S | Trust | Standard table-stakes for trust |
| 25 | Public landing: "See it work" demo | No proof without signup | Embedded video of scan → 24-book result on landing | Medium | S | Activation | Best converter for AI products |
| 26 | Error boundary + Sentry frontend hardening | Silent JS errors lose users | Audit existing Sentry coverage; add user-facing fallback UIs | Medium | S | QA | Pre-public-beta hygiene |
| 27 | Mobile camera UX polish | Scan is the core flow on mobile | Test on iOS Safari + Android Chrome; fix permission/orientation/file-size issues | High | S | QA | If mobile scan is broken, product is broken |
| 28 | i18n: EN landing parity | Czech-first risks small TAM | Ensure EN landing copy is as sharp as CS, target /en route, run on Reddit r/books | Medium | S | Activation | Cheap geographic expansion |
| 29 | "Rate / quick note" on books | No personal layer | Add 1–5 star rating + 1-line note per book | Low | S | Retention | Personal layer = stickiness |
| 30 | Family/shared library invitation flow | Member infra exists, UX doesn't | Email invite to a library; role picker | Medium | M | Monetization | Drives Pro plan upgrade |

---

## 3. Quick wins (10 small/medium, high value)

1. **Sample library on signup** — seed 15–20 demo books and shelves; instant "wow."
2. **First-book guided modal** — pick a path: Scan / ISBN / Search / Import.
3. **Scan tips overlay** — pre-capture lighting/distance coaching.
4. **Usage meters in sidebar** — surfaces free-tier limits constantly.
5. **Contextual upgrade prompt at limit** — convert intent at peak moment.
6. **Google OAuth login** — wiring already half-built; finish it.
7. **Empty-state CTAs per page** — illustrations + clear next step.
8. **Plan card relabeling** — job-to-be-done copy on `/pricing`.
9. **CSV export** — trust + churn-resilience.
10. **Reading-status filter chips on `/books`** — "Reading (3) · Want (12) · Lent (2)" surfaces returning-user value.

Each of these is a 1–3 day item with disproportionate effect.

---

## 4. Strategic bets (5 bigger moves)

1. **Scan reliability program.** Treat the scan flow as a quality system, not a feature. Confidence scoring, per-book rescan, batch accept/reject, error analytics, A/B prompts to Gemini. This is *the* product. If it doesn't feel magical, nothing else matters.
2. **Goodreads/StoryGraph importer.** The fastest path to acquiring serious readers (the people who pay) is letting them bring their existing 200-book history in 30 seconds. Pair with a "Migrating from Goodreads?" landing page.
3. **Public library profiles + sharing.** `shelfy.cz/u/janek` opt-in pages turn every paying user into a marketing surface. Czech book Twitter, Reddit r/books, BookTok all share collections.
4. **Lending-as-a-feature.** Reminders, borrower mini-CRM, lending history, a printable receipt. Position Shelfy as "the cheap, friendly Libib alternative" for book clubs and tiny libraries — that's the strongest paid-tier story for the 299 Kč Library plan.
5. **Annual reading recap + reading goals.** Adds a yearly retention moment, drives organic shares ("my 2026 in books"), and gives a reason to come back monthly to log status.

---

## 5. Priority roadmap

### Next 2 weeks — fix the activation funnel and trust

- [ ] Sample library on signup (#1)
- [ ] First-book guided modal (#2)
- [ ] Scan tips & coach (#4)
- [ ] Empty-state CTAs (#18)
- [ ] Usage meters in sidebar (#7)
- [ ] Mobile camera QA pass (#27)
- [ ] Google OAuth (#17)

**Goal:** a new user goes from signup to "I have my first 5 books cataloged" in under 5 minutes, every time.

### Next 6 weeks — close trust + start monetization

- [ ] Scan review v2 with confidence + per-book rescan (#3, #11)
- [ ] ISBN barcode scan (#6)
- [ ] Goodreads CSV import (#5)
- [ ] Contextual upgrade prompts + 14-day Pro trial (#8, #19)
- [ ] Plan comparison rewrite (#20)
- [ ] Loan reminders email (#10)
- [ ] Public library profile (#9)
- [ ] Scan completion notification (#22)

**Goal:** free→paid conversion is measurable; scan reliability complaints drop; first viral surface live.

### Next 3 months — retention loops + market expansion

- [ ] Annual recap framework (groundwork now, ship in Dec) (#14)
- [ ] Tags / collections (#15)
- [ ] Wishlist (#13)
- [ ] Family library invites (#30)
- [ ] EN landing parity + soft launch (#28)
- [ ] Reading stats on dashboard
- [ ] PWA install prompt + push (#21)

**Goal:** returning-user value is real; English-speaking experiment running; D30 retention measurably up.

---

## 6. Final recommendation — top 3 to do next

1. **Fix the first 5 minutes.** Ship sample library + guided first-book flow + empty-state CTAs together as one "new user experience" release. Right now activation almost certainly leaks badly here, and these are 1 week of work combined. Without this, nothing else compounds.
2. **Make the scan feel reliable.** Confidence indicators, per-book rescan, scan tips before capture. The AI scan is the entire reason someone picks Shelfy over a spreadsheet — if it lies even occasionally, trust collapses and word-of-mouth dies. Treat this as a continuous program, not a one-off.
3. **Ship Goodreads CSV import + contextual upgrade prompts together.** Import unlocks the user segment most likely to pay (people with 200+ books and a Goodreads history); upgrade prompts capture them at the exact moment they hit a free-tier wall. These two together convert the audience the product is actually built for.

Everything else — public profiles, recaps, lending CRM, tags — is real and worth building, but only matters if the first three are working. Get a new user from signup → first cataloged shelf → "I want more" in one session, and the rest of the roadmap has something to compound on.
