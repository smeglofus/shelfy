# Stripe Apple Pay / Google Pay readiness checklist

Hosted Stripe Checkout (subscription mode) renders the **Apple Pay** and
**Google Pay** buttons automatically when three conditions line up:

1. The Stripe **account** has `card` enabled (Dashboard → Settings → Payment
   methods).
2. The customer's **browser/device** supports the wallet (Safari on iOS/macOS
   for Apple Pay; Chrome with a tokenised card for Google Pay).
3. For Apple Pay only: the **app domain** that links to Checkout (our
   `APP_URL`) is registered as a verified `PaymentMethodDomain` in the Stripe
   account.

Google Pay does **not** require server-side domain registration on hosted
Checkout — it follows from the `card` payment method being enabled.

This doc is the single source of truth ops should walk through after every
new environment, domain rename, or Stripe-account swap. Pair it with the two
verifier scripts:

```bash
cd backend
python -m scripts.verify_stripe_prices    # plan/interval → price_id mapping
python -m scripts.verify_stripe_wallets   # Apple Pay domain registration
```

Both exit non-zero on misconfig so they slot into a CI gate / pre-deploy hook.

---

## Why we don't pass `payment_method_types` from the server

`backend/app/services/billing.py::create_checkout_session` deliberately
**omits** the `payment_method_types` argument when it calls
`stripe.checkout.Session.create(...)`. That is intentional and the most
important wallet-related design decision in this repo.

When `payment_method_types` is **omitted**, Stripe falls back to the payment
methods enabled in the Dashboard. Apple Pay / Google Pay are surfaced through
the same `card` capability — no separate flag is required and no code change
is needed to enable them.

When `payment_method_types` is **passed**, it **silently overrides** the
Dashboard configuration. Passing `["card"]` works, but passing
`["card", "ideal"]` (for example) drops every other method including the
wallets, with no error. This is the #1 reason wallets disappear in prod.

If you need to constrain payment methods per session in the future, do it via
the Dashboard's Payment Method Configurations and pass
`payment_method_configuration=...` instead of `payment_method_types=...`.

---

## Stripe Dashboard — one-time setup per account

Do this once per Stripe account (test + live are separate accounts; both
need the steps).

- [ ] **Enable card payments**
  Dashboard → Settings → Payment methods → toggle **Cards** ON. This is what
  makes Apple Pay and Google Pay eligible to render at all.

- [ ] **Verify the account is in the right country**
  Dashboard → Settings → Account details. Apple Pay and Google Pay are
  available in the supported-country list at
  https://stripe.com/docs/payments/payment-methods/overview . `CZ` (Czech
  Republic) is supported.

- [ ] **Confirm the business has been activated**
  Wallets only render in live mode for **activated** accounts. Test mode
  works without activation.

- [ ] **(Optional) Pin a Payment Method Configuration**
  Dashboard → Settings → Payment methods → Configurations. Create one named
  e.g. `default-with-wallets` with Cards / Apple Pay / Google Pay enabled
  and mark it default. Useful when you want different methods for different
  flows (e.g. Subscriptions vs one-off).

---

## Per-domain setup (Apple Pay only)

Apple Pay needs **every domain that hosts a button or redirects to Checkout**
to be registered with Stripe. For us that's whatever `APP_URL` resolves to
in the running environment — typically:

- Production: `https://shelfy.cz` (or `https://app.shelfy.cz` if split)
- Staging: `https://staging.shelfy.cz`
- Preview / PR builds: skip — Apple Pay won't render but Checkout still
  works with cards

### Steps per domain

- [ ] **Add the domain in the Dashboard**
  Dashboard → Settings → Payment methods → Apple Pay → **Add a new domain**.
  Paste the bare hostname (no scheme, no path): `shelfy.cz`.

- [ ] **Host the well-known association file**
  Stripe shows a download link for
  `apple-developer-merchantid-domain-association`. Place it at:

  ```
  https://<domain>/.well-known/apple-developer-merchantid-domain-association
  ```

  It must be served as **plain text** with HTTP 200. No redirects, no auth,
  no MIME translation. Test:

  ```bash
  curl -fsSI https://shelfy.cz/.well-known/apple-developer-merchantid-domain-association
  ```

  Expect `HTTP/2 200` and `content-length` matching the file Stripe gave
  you.

- [ ] **Click "Verify" in the Dashboard**
  Stripe fetches the file and flips status to **active**. From this point
  on Stripe re-checks every ~24 h — if the file goes missing, status flips
  back to `inactive` and the wallet disappears.

- [ ] **Confirm the same domain in `APP_URL`**
  ```bash
  cd backend
  python -m scripts.verify_stripe_wallets
  ```
  Exit code `0` means: APP_URL host matches a registered+verified domain.
  Exit code `1` means: misconfig — read the warning and fix.

---

## Subscription-mode requirements (already handled in code)

Apple Pay / Google Pay on a recurring charge needs the SetupIntent that
backs the subscription to use `setup_future_usage=off_session`. Stripe sets
this automatically for `mode=subscription` so we don't pass it explicitly.

Our `create_checkout_session` also passes:

- `payment_method_collection="always"` — required so that even a 14-day
  trial collects a card up front (which is what the wallet button does).
- `mode="subscription"` — the wallet UX differs from one-off mode; we use
  subscription throughout.
- (No `payment_method_types`.) See the section above for why.

---

## End-to-end test scenarios

Run these against the **live** account from a real device + browser. Stripe
test mode does not surface real Apple Pay / Google Pay buttons.

### Apple Pay

- [ ] **iPhone (Safari)**
  Open the app, hit Upgrade → Pro → monthly → Continue → land on Stripe
  Checkout. The Apple Pay button should appear above the card form. Tap it
  → Touch ID / Face ID prompt → success → redirect to
  `/settings?billing_success=1`.

- [ ] **macOS (Safari) with paired iPhone**
  Same flow. Apple Pay button uses Touch ID on the Mac (or biometric on the
  paired phone).

- [ ] **macOS (Chrome / Firefox)**
  Apple Pay button MUST NOT appear (only Safari supports it on macOS). Card
  form should still work.

- [ ] **Domain not registered (negative case)**
  Temporarily un-register the domain in Dashboard. Reload Checkout in
  Safari — Apple Pay button disappears. Re-register; button comes back
  within ~30 s.

### Google Pay

- [ ] **Android (Chrome) with a Google Pay-enabled card**
  Open the app, hit Upgrade → Pro → Continue → Checkout shows the
  Google Pay button. Tap → fingerprint / device auth → success.

- [ ] **Desktop Chrome signed in to Google with a tokenised card**
  Same — Google Pay button appears. Useful for QA when a phone isn't
  available.

- [ ] **Desktop Chrome with no tokenised card**
  Button SHOULD NOT appear; card form should still work. This is browser
  behaviour, not a server misconfig — there's nothing to fix.

### Plan / interval coverage

For each plan × interval combination once per release:

- [ ] Home monthly
- [ ] Home yearly
- [ ] Pro monthly
- [ ] Pro yearly
- [ ] Library monthly
- [ ] Library yearly

The wallet button must appear (when device-eligible) for all six.

---

## Diagnostics & runbooks

### Wallet button missing in production

1. Run `python -m scripts.verify_stripe_wallets` against the production
   Stripe account. If exit ≠ 0, the warning text tells you what's broken
   (host mismatch, domain not registered, verification expired).
2. Check the request log for the most recent
   `stripe_checkout_session_created` line. Confirm:
   - `wallet_compatible=True`
   - `explicit_payment_method_types=False`
   - `app_url_host=<your prod host>`
3. Open the same Checkout URL in Safari **on a real iPhone**. If Apple Pay
   still doesn't appear, the issue is downstream of the server (browser
   cache, account capability, well-known file 404).
4. `curl -I https://<domain>/.well-known/apple-developer-merchantid-domain-association`.
   Anything other than `200 OK` plain text breaks Apple Pay.

### "It works in test mode but not live"

Test and live are separate Stripe accounts. The whole checklist above must
be repeated for the live account. The verifier script tells you which mode
it's hitting based on the key prefix (`sk_test_…` vs `sk_live_…`).

### "Google Pay button still missing on Android"

Google Pay needs a tokenised card in the Google Pay app on the device. Add
a card, lock + unlock the phone (forces token refresh), retry. There is no
server fix for this — it's per-user state.

---

## Operator endpoint

Authenticated users can hit:

```
GET /api/v1/billing/wallet-readiness
```

It returns the same assessment the verifier script prints, as JSON:

```json
{
  "ok": true,
  "app_url_host": "shelfy.cz",
  "app_url_https": true,
  "apple_pay_domain_registered": true,
  "apple_pay_domain_verified": true,
  "warnings": []
}
```

`warnings` is non-empty exactly when `ok` is false. Useful for synthetic
monitoring — alert when `ok=false` for >5 min.
