# Shelfy — Právní implementace: co zbývá doplnit

Datum: 2026-04-08
Navazuje na: `CZ_LEGAL_CHECKLIST.md`, `PrivacyPage.tsx`, `TermsPage.tsx`

---

## A. Co doplnit do textů vlastními údaji

| Kde | Co chybí | Poznámka |
|-----|----------|----------|
| PrivacyPage.tsx | **Sídlo** (řádek `Sídlo: —`) | Doplnit adresu z živnostenského rejstříku |
| TermsPage.tsx | **Sídlo** (řádek `Sídlo: —`) | Totéž |
| PrivacyPage.tsx | **Kontaktní e-mail** `privacy@shelfy.cz` | Ověřit že schránka existuje a přijímá poštu |
| TermsPage.tsx | **Kontaktní e-mail** `info@shelfy.cz` | Ověřit že schránka existuje a přijímá poštu |
| TermsPage.tsx, bod 4 | **DPH status** — „není plátcem DPH" vs „ceny zahrnují DPH" | Upřesnit po konzultaci s daňovým poradcem |
| TermsPage.tsx, bod 5 | **Refund politika** — 14 dní, individuálně | Rozhodnout zda chceš pevnou lhůtu (7 / 14 / 30 dní) |
| PrivacyPage.tsx, bod 5 | **PostHog retence** — uvedeno 12 měsíců | Ověřit nastavení v PostHog dashboard |
| PrivacyPage.tsx, bod 5 | **Sentry retence** — uvedeno 90 dní | Ověřit nastavení v Sentry projektu |

---

## B. Technický/procesní checklist

### Musí být splněno PŘED go-live

- [ ] **E-mailové schránky** `privacy@shelfy.cz` a `info@shelfy.cz` fungují a jsou monitorovány
- [ ] **Stripe Invoicing** zapnuto — české fakturační údaje (IČO, sídlo, „Nejsem plátce DPH")
- [ ] **Stripe Checkout** — přidat checkbox: *„Souhlasím s okamžitým zpřístupněním služby a beru na vědomí, že tím ztrácím právo na odstoupení od smlouvy do 14 dnů."* (pro vyloučení 14denní lhůty)
- [ ] **Sídlo doplněno** v PrivacyPage.tsx a TermsPage.tsx
- [ ] **PostHog opt-out mechanismus** — buď cookie banner s možností odmítnutí analytiky, nebo alespoň instrukce v Privacy Policy jak vznést námitku (je tam e-mail — minimální varianta splněna)

### Mělo by být do 30 dnů od go-live

- [ ] **Záznamy o zpracování (GDPR čl. 30)** — interní dokument (neveřejný), obsahuje:
  - Seznam kategorií osobních údajů
  - Účely zpracování a právní základ ke každému
  - Kategorie příjemců (zpracovatelů)
  - Plánované lhůty pro výmaz
  - Popis bezpečnostních opatření
  - Formát: stačí tabulka v Google Docs / Notion / PDF
- [ ] **DPA (Data Processing Agreements)** — ověřit že máš platné DPA s:
  - Stripe (automaticky součástí Stripe ToS)
  - Google Cloud / Gemini API (automaticky v Google Cloud ToS)
  - Sentry (automaticky v Sentry DPA)
  - PostHog (automaticky v PostHog DPA)
  - Resend (ověřit v jejich ToS)
  - Cloudflare (automaticky v Cloudflare DPA)
- [ ] **Kontrola daňového poradce** — DPH status, OSS, fakturace

### Nice-to-have (doporučeno)

- [ ] **Cookie banner** s granulárním souhlasem (nezbytné vs analytika)
- [ ] **Anglická verze** Privacy Policy a Terms (pokud plánuješ anglické uživatele)
- [ ] **Vzorový formulář pro odstoupení** jako příloha VOP nebo ke stažení
- [ ] **Automatický e-mail po registraci** s odkazem na VOP a Privacy Policy

---

## C. Poznámky k implementaci

### Stripe Checkout — checkbox odstoupení

V Stripe Checkout lze přidat custom fields. Alternativně přidat checkbox
do vlastní registrační/upgrade stránky PŘED redirectem na Stripe:

```
☐ Souhlasím s okamžitým zpřístupněním služby a beru na vědomí,
  že tím ztrácím právo na odstoupení od smlouvy ve lhůtě 14 dnů
  (§ 1837 písm. l) občanského zákoníku).
```

Bez tohoto checkboxu má spotřebitel právo odstoupit a žádat plnou refundaci
do 14 dnů — i když službu aktivně používal.

### PostHog — opt-out

Aktuální stav: PostHog běží pro všechny uživatele, bez cookies, s localStorage.
Právní základ: oprávněný zájem (čl. 6/1f).

Minimální varianta (splněna): Privacy Policy obsahuje informaci + kontakt pro námitku.

Lepší varianta: Přidat do PostHog init podmínku respektující uživatelskou preferenci:

```typescript
// V analytics init:
if (localStorage.getItem('shelfy_analytics_consent') !== 'denied') {
  posthog.init(...)
}
```

S cookie bannerem nebo toggle v Nastavení.

### Smazání účtu vs fakturační záznamy

Při DELETE /api/v1/auth/me se smažou všechna data. Stripe záznamy zůstávají
na straně Stripe (právní povinnost pro fakturaci). To je v souladu s GDPR čl. 17/3b
(zákonná povinnost uchovávání).

---

## D. Co texty NEŘEŠÍ (a proč)

| Téma | Důvod |
|------|-------|
| DMCA / copyright takedown | Uživatelé nahrávají vlastní knihy, ne cizí obsah. Pokud se to změní, přidat. |
| Věkový souhlas (COPPA/GDPR čl. 8) | Limit 16+ je v Terms. Pro děti pod 16 by byl potřeba souhlas rodiče — zatím irelevantní. |
| Multi-tenant / enterprise SLA | Zatím jsi single-operator. Pokud přidáš enterprise plán, přidat SLA dokument. |
| Cookie consent banner | Popsáno jako TODO výše. Technicky není blokující pokud PostHog nepoužívá cookies (localStorage). Ale doporučeno. |
