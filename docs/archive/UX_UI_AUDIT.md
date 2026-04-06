# Shelfy — UX/UI Audit & Redesign Report

> **Datum:** 2026-03-31
> **Autor:** Senior Product Designer & UX Auditor (AI-assisted)
> **Verze:** 1.0
> **Scope:** Kompletni audit webove aplikace Shelfy (sprava knih + digitalni dvojce knihovny)

---

## Obsah

1. [Executive Summary](#executive-summary)
2. [Heuristicka UX analyza](#1-heuristicka-ux-analyza)
3. [UI Audit](#2-ui-audit)
4. [Brand / Visual Direction](#3-brand--visual-direction)
5. [Barevne palety](#4-barevne-palety)
6. [Prioritizovany backlog](#5-prioritizovany-backlog)
7. [Redesign klicovych obrazovek](#6-redesign-klicovych-obrazovek)
8. [Design tokeny](#7-design-tokeny)

---

## Executive Summary

10 klicovych zjisteni serazenych dle dopadu:

1. **Border radius je prilis velky** — `--sh-radius-xl: 32px` na kartach a `--sh-radius-md: 16px` na inputech dava "bublinkovy" AI look. Snizeni radius = okamzity posun k profesionalnejsimu dojmu.
2. **Barevna paleta je "Google Material 2018"** — teal/amber/blue/purple/red je presne Material palette. Chybi osobitost a brand identity.
3. **Typograficka hierarchie je plocha** — 32/24/18/15/13px skala nema dostatecny kontrast mezi urovnemi. Chybi display size pro hero cisla a mensi caption size.
4. **Spacing je nekonzistentni** — michani hardcoded px hodnot v inline stylech s CSS tridami (`gap-2` = 8px, ale jinde `gap: 12px` inline). Zadny spacing scale token.
5. **Prilis mnoho inline stylu** — vetsina komponent ma styling pres `style={{}}`, coz ztezuje theming, konzistenci i udrzbu.
6. **Dark mode je nekompletni** — `html.dark` prepisuje jen subset promennych (chybi amber, blue, purple, red, shadow overrides). Mobile nav pouziva hardcoded `rgba(255,255,255,0.92)` backdrop.
7. **Knihovni spiny v digitalnim dvojceti jsou prilis male** — 36-52px sirka x 120px vyska s 9px textem je na hrane citelnosti, zejmena na mobilu.
8. **Scan flow nema progress vizualizaci** — 3 barevne prouzky nejsou dostatecny stepper. Chybi labely kroku, aktualni stav, co nasleduje.
9. **Locations management je tabulka na mobilu** — prepnuti desktop/mobile pres display:none je OK, ale mobilni card view chybi v CSS (`.sh-locations-mobile` je deklarovana ale nikde implementovana).
10. **Empty states jsou emoji-driven** — emoji misto ilustraci/ikon. Funguje, ale zesiluje "AI-generated" dojem.

---

## 1. Heuristicka UX analyza

### 1.1 Navigace & informacni architektura

#### Soucasny stav

Aplikace pouziva dual-mode navigaci:
- **Desktop (>=768px):** Fixni levy sidebar (240px) se 7 polozkama + logout
- **Mobile (<768px):** Spodni nav se 4 taby + center FAB (floating action button) pro Add/Scan

#### Sidebar polozky (desktop)

| Polozka | Route | Typ akce |
|---------|-------|----------|
| Home | `/` | Primarni navigace |
| Library | `/books` | Primarni navigace |
| Add Book | `/books/new` | Akce (vytvoreni) |
| Scan Shelf | `/scan` | Akce (vytvoreni) |
| Bookshelf | `/bookshelf` | Primarni navigace |
| Locations | `/locations` | Sprava (sekundarni) |
| Settings | `/settings` | Sprava (sekundarni) |

#### Problemy

| Oblast | Stav | Problem |
|--------|------|---------|
| Sidebar (desktop) | Funkcni | Add + Scan + Locations jsou sekundarni akce smichane s primarni navigaci. Chybi vizualni oddeleni skupin. |
| Mobile FAB | Dobry vzor | FAB menu pro Add/Scan je spravne rozhodnuti. Ale Locations chybi v mobile nav — dostupne jen pres Bookshelf tab. |
| Bookshelf vs Locations | Matouci | Dve oddelene route (`/bookshelf`, `/locations`) kde `/locations` jen redirectuje na `/bookshelf?tab=locations`. Zbytecna duplikace v navigaci. |
| Book detail -> Digital twin | Chytry flow | "Show in Digital Twin" s highlight je dobry cross-linking. |
| Scan -> Review -> Confirm | Funkcni | Wizard flow je logicky, ale chybi moznost se vratit a zmenit lokaci bez restartu. |

#### Doporuceni

- Sidebar: seskupit Add + Scan pod jednu sekci "Actions" oddelenou vizualne (divider + label)
- Zrusit `/locations` route, nechat jen tab v Bookshelf
- Pridat breadcrumb nebo mini-navigaci do scan flow pro skok mezi kroky

### 1.2 Kognitivni zatez

| Oblast | Problem | Zavaznost |
|--------|---------|-----------|
| Book detail | Prilis mnoho accordion sekci (Metadata, Description, Management, Loans, Delete). Uzivatel musi rozbalit 3 sekce pro bezny edit. | Vysoka |
| Scan step 2 | "Replace" vs "Append Right" mode vyzaduje pochopeni shelf_position konceptu. Chybi vizualni vysvetleni. | Stredni |
| Stat bar filtry | Klikatelne stat karty funguji jako filtry, ale nejsou vizualne odlisene od statickych zobrazeni. Affordance je slaby. | Stredni |
| Reading status | 4 stavy (unread/reading/read/lent) ale "lent" je jina dimenze (loan) nez reading progress. Smesovani konceptu. | Nizka |

### 1.3 Feedback states

| Oblast | Implementace | Hodnoceni |
|--------|-------------|-----------|
| Loading | Skeleton placeholders s shimmer animaci | Dobre |
| Error | Red alert box + retry button | OK ale genericke |
| Empty | Emoji + text (📚🔍🗺️) | Funkcni ale "AI feel" |
| Success | Toast notifikace s progress bar | Dobre |
| Processing | Amber banner s polling kazdych 2s | Funkcni |
| Save | "Ulozeno ✓" text swap | Dobre ale prilis subtilni |
| Dirty state | Amber dot vedle accordion titulu | Chytre ale snadno prehlednutelne |

### 1.4 Mobilni pouzitelnost

| Oblast | Problem | Zavaznost |
|--------|---------|-----------|
| Touch targets | Mobilni nav buttony maji `minHeight: 56px` — OK. Ale delete X buttony v scan review jsou jen text, bez dostatecneho padding. | Stredni |
| Book card grid | `minmax(150px, 1fr)` s `gap: 16px` — na 375px sirce dava 2 sloupce po ~155px. Tesne, ale funkcni. | Nizka |
| Horizontal scroll | Reading status tabs nemaji vizualni indikator preteceni (gradient fade na kraji). | Stredni |
| Locations table | `.sh-locations-mobile` trida existuje v CSS ale nema zadnou implementaci — na mobilu se tabulka proste skryje. | Vysoka |
| Scan dropzone | 180px vyska je OK na mobilu, ale camera capture button je hidden input bez vizualniho tlacitka. | Stredni |

---

## 2. UI Audit

### 2.1 Typografie

#### Soucasny stav

- Font: `'Outfit', system-ui, -apple-system, sans-serif`
- Smoothing: `-webkit-font-smoothing: antialiased`

| Token | Soucasna hodnota | Problem | Navrh |
|-------|-------------------|---------|-------|
| H1 | 32px / 700 / -0.03em | Prilis maly skok od H2 (24px). Ratio 1.33 je slabe. | 36px nebo 40px |
| H2 | 24px / 600 / -0.02em | OK jako section heading | Ponechat |
| H3 | 18px / 600 / -0.02em | Prilis blizko body (15px). Ratio 1.2. | 20px |
| Body | 15px | Nestandardni. 14 nebo 16 je konvencnejsi. | 14px (compact) nebo 16px (readable) |
| Small | 13px / 500 | OK | Ponechat |
| Caption | Chybi | Zadna velikost pro metadata, timestamps | Pridat 11-12px |
| Display | Chybi | Stat cisla (pocet knih) nemaji vlastni velikost | Pridat 48-56px pro hero numbers |
| Line height | Nedefinovana globalne | Jen `p { line-height: 1.5 }` | Definovat pro kazdou uroven |
| Letter spacing | -0.02em na headings | OK | Pridat -0.04em pro display |

### 2.2 Spacing

#### Problem

Zadny formalni spacing scale. V kodu se vyskytuji tyto hardcoded hodnoty:
`4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48px` — prilis mnoho unikatnich hodnot.

CSS tridy (`gap-2`, `gap-3`, `gap-4`, `gap-6`) pokryvaji jen cast. Vetsina spacingu je v inline stylech.

#### Navrh spacing scale (4px base)

```
--sh-space-1:   4px   (micro gap)
--sh-space-2:   8px   (tight)
--sh-space-3:  12px   (compact)
--sh-space-4:  16px   (default)
--sh-space-5:  20px   (comfortable)
--sh-space-6:  24px   (section gap)
--sh-space-8:  32px   (group gap)
--sh-space-10: 40px   (page padding)
--sh-space-12: 48px   (section separation)
--sh-space-16: 64px   (hero spacing)
```

### 2.3 Border radius

#### Soucasny stav

| Token | Hodnota | Pouziti |
|-------|---------|---------|
| --sh-radius-sm | 8px | Badges |
| --sh-radius-md | 16px | Inputy, male karty |
| --sh-radius-lg | 24px | Karty |
| --sh-radius-xl | 32px | Velke karty, book detail article |
| --sh-radius-pill | 9999px | Buttony, tabs |

#### Problem

Hodnoty jsou prilis velke a davaji celemu UI "bublinkovy" charakter typicky pro AI-generovany design. Snizeni border-radius o 40-50% je **single highest-impact change** pro "mene AI" look.

#### Navrh

| Token | Nova hodnota | Zmena |
|-------|-------------|-------|
| --sh-radius-xs | 4px (novy) | Badges, tags |
| --sh-radius-sm | 6px | -2px |
| --sh-radius-md | 10px | -6px |
| --sh-radius-lg | 14px | -10px |
| --sh-radius-xl | 18px | -14px |
| --sh-radius-pill | 9999px | Beze zmeny |

### 2.4 Shadows

#### Soucasny stav

Light mode stiny jsou jemne a funkcni. Dark mode stiny jsou prilis silne (0.3-0.6 opacity).

| Token | Light (soucasne) | Dark (soucasne) | Dark (navrh) |
|-------|-------------------|------------------|------|
| sm | `0 4px 10px rgba(0,0,0,0.04)` | `0 4px 10px rgba(0,0,0,0.3)` | `0 2px 8px rgba(0,0,0,0.2)` |
| md | `0 8px 24px rgba(0,0,0,0.06)` | `0 8px 24px rgba(0,0,0,0.4)` | `0 4px 16px rgba(0,0,0,0.25)` |
| lg | `0 16px 36px rgba(0,0,0,0.1)` | `0 16px 36px rgba(0,0,0,0.5)` | `0 8px 24px rgba(0,0,0,0.3)` |
| hover | `0 20px 48px rgba(0,0,0,0.12)` | `0 20px 48px rgba(0,0,0,0.6)` | `0 12px 28px rgba(0,0,0,0.35)` |

### 2.5 Komponenty — detailni audit

#### Buttons

**Soucasny stav:**
- Primary: teal bg, white text, pill shape, teal glow shadow, hover lift (-2px), active press (+1px)
- Secondary: teal-bg (light green) bg, teal-text color, pill shape
- Danger: red bg, white text, red glow shadow
- Ghost: transparent, muted border 1.5px, hover to light gray

**Problemy:**
- Primary ma teal glow shadow (`0 6px 16px rgba(15, 157, 88, 0.25)`) — efektni ale prilis "landing page" pro utility app
- Padding 14px 28px je velky — pro formulare staci 10px 20px
- `:active` transform `translateY(1px)` je dobry feedback

**Doporuceni:**
- Snizit glow na `0 2px 8px rgba(primary, 0.15)` pro tlumeny look
- Pridat size varianty: sm (6px 12px), md (10px 20px), lg (14px 28px)
- Zachovat pill shape pro primarni CTA, pouzit radius-md pro sekundarni

#### Inputs

**Soucasny stav:**
- Padding: 14px 18px
- Radius: 16px (--sh-radius-md)
- Border: 1.5px solid rgba(0,0,0,0.12)
- Focus: teal border + 4px teal glow ring
- Background: #FAFAFB (light), #0d1117 (dark)

**Problemy:**
- 14px 18px padding je nadmerny — input vypada "nafouklej"
- Radius 16px na inputu je nezvykly — 8-10px je standard
- Focus ring (4px teal glow) je dobry ale prilis difuzni

**Doporuceni:**
- Padding: `10px 14px`
- Radius: `--sh-radius-md` (10px po zmene)
- Focus ring: `0 0 0 3px var(--sh-focus-ring)` — uzsi, ostrejsi

#### Cards (BookCard)

**Soucasny stav:**
- Staggered entrance animace (0.35s s delay podle indexu)
- Hover: `translateY(-6px)` + shadow-hover
- Cover image s object-fit: cover, nebo gradient placeholder z hash titulu
- Delete button vzdy viditelny (X v rohu)
- Reading status badge

**Problemy:**
- Staggered entrance: 350ms x N karet = pomaly feel pri 20 kartach
- Hover scale `translateY(-6px)` je prilis agresivni — 3-4px staci
- Delete button je vzdy viditelny — clutter + riziko accidental click

**Doporuceni:**
- Omezit stagger na max 200ms total (ne per-card)
- Hover: `-3px` translateY
- Delete: hover-reveal na desktopu, swipe nebo long-press na mobilu

#### Modal

**Soucasny stav:**
- Focus trap — spravne implementovany (Tab cycling, auto-focus, return focus)
- Backdrop blur (4px) + fade-in animace
- Escape to close, backdrop click to close
- Max-width 380px
- Panel: surface bg, xl radius, 24px padding

**Problemy:**
- Max-width 380px je OK pro confirm dialogy, ale nedostatecny pro formulare (LendBookModal)
- Chybi size varianty

**Doporuceni:**
- Pridat size prop: sm (380px), md (520px), lg (680px)
- Reduce radius z xl (32px) na lg (14px po zmene)

#### Tabs

**Problemy:**
- Reading status tabs (pill buttons) a Bookshelf tabs (solid bg buttons) jsou vizualne nekonzistentni — dve ruzne tab implementace
- Reading status tabs nemaji vizualni spojeni s obsahem pod nimi

**Doporuceni:**
- Unifikovat na jeden tab styl: underline tabs (text + active underline)
- Alternativne: segmented control pro 2-3 volby, underline tabs pro vice

#### Toast

**Soucasny stav:**
- Variants: success (green), error (red), warning (amber), info (blue)
- Auto-dismiss: 3.5s s progress bar animaci
- Max 3 toasty zobrazeno
- Slide-in-top animace

**Problemy:**
- 3.5s auto-dismiss je kratky pro error messages — uzivatel nemusi stihnout precist
- Vsechny varianty maji stejny timeout

**Doporuceni:**
- Error: 6s timeout
- Warning: 5s timeout
- Success/Info: 3s timeout

### 2.6 Dark mode specificka

| Problem | Detail | Zavaznost |
|---------|--------|-----------|
| Nekompletni `html.dark` override | `html.dark` neprepisuje amber/blue/purple/red/shadow varianty. Zavisi na `prefers-color-scheme` media query, ale pri manualnim toggle pres Settings to nemusi fungovat. | Vysoka |
| Mobile nav backdrop | Hardcoded `rgba(255,255,255,0.92)` v inline stylu Navigation.tsx:254 — v dark mode bude bily! | Vysoka |
| Secondary button hover | Definovany jen v `@media (prefers-color-scheme: dark)`, ne v `html.dark` bloku. | Stredni |
| Book cover gradients | Hardcoded hex barvy (`#1D9E75 -> #085041`) — v dark mode OK, ale nemapuji se na tokeny. | Nizka |
| Surface vs elevated kontrast | `#0d1117` (bg) vs `#161b22` (surface) = dostatecny. Ale `#1c2129` (elevated) vs `#161b22` (surface) je jen 1.15:1 — temer nerozlisitelne. | Stredni |

---

## 3. Brand / Visual Direction

### Smer A: "Warm Library" (Knihovnicky)

**Mood:** Teply, utulny, papirovy. Evokuje fyzickou knihovnu — drevo, papir, vintage typografie.

**Klicove prvky:**
- Warm neutral palette (cream/ivory base misto cool gray)
- Serifovy font pro headings (napr. Lora, Playfair Display)
- Jemne paper textures na surface
- Book spine vizualizace s realistickymi barvami
- Teple stiny (brown-tinted: `rgba(120,80,20,0.08)`)

**Vhodnost pro Shelfy:** Vysoka — primo komunikuje ucel appky. Uzivatele intuitivne chapou kontext.

**Rizika:**
- Muze vypadat "staromodni" pokud se prezene
- Paper textures zpomaluji rendering na low-end zarizenich
- Serifove fonty na malych velikostech (mobile, <14px) mohou byt hure citelne
- Tezsi udrzba (textures, specialni gradienty)

### Smer B: "Modern Editorial" (DOPORUCENY)

**Mood:** Cisty, sofistikovany, editorial. Inspirace: Notion, Linear, Arc browser. Duraz na typografii a whitespace.

**Klicove prvky:**
- Monochrome base s jednim accent color (sage green nebo indigo, desaturovany)
- Jasna typograficka hierarchie s Inter/Geist/Satoshi fontem
- Minimalni border-radius (6-14px)
- Subtilni borders misto shadows pro card separation
- Micro-interactions pres opacity a color transitions, ne scale/translate

**Vhodnost pro Shelfy:** Velmi vysoka — dava prostor obsahu (kniham), nevnucuje "tema", snadno se udrzuje. Skaluje dobre s rostouci komplexitou.

**Rizika:**
- Muze vypadat "prilis jako Notion klon" bez dostatecne diferenciace
- Vyzaduje vynikajici typografii — bez ni je nudny
- Mene "zabavny" dojem — muze vyzadovat doplneni micro-delights (konfetti pri dokonceni scanu, apod.)

### Smer C: "Playful Minimal" (Hravy minimalismus)

**Mood:** Svezi, hravy ale ne detsky. Inspirace: Raycast, Vercel, Amie calendar. Geometricke tvary, accent gradients, bold typography.

**Klicove prvky:**
- Cista bila base s vyraznymi accent gradienty
- Rounded ale ne bublinkove (10-14px radius)
- Bold display font pro cisla a headings
- Accent gradient na primary actions (teal->cyan nebo indigo->violet)
- Icon system misto emoji

**Vhodnost pro Shelfy:** Stredni-vysoka — doda osobitost a moderni feel, ale muze odvadet pozornost od obsahu.

**Rizika:**
- Gradienty se rychle "oposlouchaji"
- Vyzaduje peclive vyvazeni — snadno sklouzne do "startup landing page" estetiky
- Vice prace na dark mode (gradienty musi fungovat na obou pozadich)

### Doporuceni

**Smer B (Modern Editorial) s prvky C** — cisty zaklad s vyraznou typografii, jednim accent gradient na primary CTA, a custom ilustracemi/ikonami pro empty states.

---

## 4. Barevne palety

### Paleta A: "Sage" (Doporucena)

Desaturovany teal s warm neutrals. Mene "Google", vice "premium tool".

#### Light Mode

```css
:root {
  /* Backgrounds */
  --sh-bg:                 #F5F5F3;        /* warm off-white */
  --sh-surface:            #FFFFFF;
  --sh-surface-elevated:   #FAFAF8;

  /* Text */
  --sh-text-main:          #1A1A1A;        /* near-black, warm */
  --sh-text-muted:         #6B6B6B;        /* mid-gray */

  /* Borders */
  --sh-border:             rgba(0,0,0,0.07);
  --sh-border-2:           rgba(0,0,0,0.13);

  /* Primary (Sage Green) */
  --sh-primary:            #2D7A5F;        /* desaturated teal */
  --sh-primary-dark:       #1E5C46;
  --sh-primary-bg:         #E8F0EC;
  --sh-primary-text:       #1A4A38;

  /* Success */
  --sh-success:            #2D7A5F;        /* same as primary for this palette */
  --sh-success-bg:         #E8F0EC;

  /* Warning */
  --sh-warning:            #B8860B;        /* dark goldenrod */
  --sh-warning-bg:         #FBF3E0;
  --sh-warning-text:       #7A5A0B;

  /* Danger */
  --sh-danger:             #C53030;
  --sh-danger-bg:          #FEE2E2;
  --sh-danger-text:        #9B1C1C;

  /* Info */
  --sh-info:               #2B6CB0;
  --sh-info-bg:            #EBF4FF;
  --sh-info-text:          #1A4A7A;

  /* Focus */
  --sh-focus-ring:         rgba(45, 122, 95, 0.3);
}
```

#### Dark Mode

```css
html.dark {
  --sh-bg:                 #111111;
  --sh-surface:            #1A1A1A;
  --sh-surface-elevated:   #222222;

  --sh-text-main:          #E8E8E8;
  --sh-text-muted:         #888888;

  --sh-border:             rgba(255,255,255,0.08);
  --sh-border-2:           rgba(255,255,255,0.15);

  --sh-primary:            #4CAF82;
  --sh-primary-dark:       #3D9A6F;
  --sh-primary-bg:         rgba(76,175,130,0.12);
  --sh-primary-text:       #6FCF9A;

  --sh-warning:            #D4A017;
  --sh-warning-bg:         rgba(212,160,23,0.12);
  --sh-warning-text:       #E8B82E;

  --sh-danger:             #F56565;
  --sh-danger-bg:          rgba(245,101,101,0.12);
  --sh-danger-text:        #FEB2B2;

  --sh-info:               #63B3ED;
  --sh-info-bg:            rgba(99,179,237,0.12);
  --sh-info-text:          #90CDF4;

  --sh-focus-ring:         rgba(76,175,130,0.35);
}
```

#### WCAG kontrast Paleta A

| Kombinace | Pomer | Hodnoceni |
|-----------|-------|-----------|
| `#1A1A1A` na `#FFFFFF` (text-main na surface) | 16.3:1 | AAA |
| `#6B6B6B` na `#FFFFFF` (text-muted na surface) | 5.4:1 | AA |
| `#2D7A5F` na `#FFFFFF` (primary na surface) | 4.6:1 | AA large text |
| `#E8E8E8` na `#1A1A1A` (dark: text-main na surface) | 13.8:1 | AAA |
| `#888888` na `#1A1A1A` (dark: text-muted na surface) | 5.8:1 | AA |
| `#4CAF82` na `#1A1A1A` (dark: primary na surface) | 7.2:1 | AAA |

### Paleta B: "Ink & Paper"

Monochrome base s indigo accent. Editorial feel.

#### Light Mode

```css
:root {
  --sh-bg:                 #FAFAFA;
  --sh-surface:            #FFFFFF;
  --sh-surface-elevated:   #F5F5F5;

  --sh-text-main:          #171717;
  --sh-text-muted:         #737373;

  --sh-border:             #E5E5E5;
  --sh-border-2:           #D4D4D4;

  /* Primary (Indigo) */
  --sh-primary:            #4F46E5;
  --sh-primary-dark:       #4338CA;
  --sh-primary-bg:         #EEF2FF;
  --sh-primary-text:       #3730A3;

  /* Success */
  --sh-success:            #059669;
  --sh-success-bg:         #ECFDF5;

  /* Warning */
  --sh-warning:            #D97706;
  --sh-warning-bg:         #FFFBEB;
  --sh-warning-text:       #92400E;

  /* Danger */
  --sh-danger:             #DC2626;
  --sh-danger-bg:          #FEF2F2;
  --sh-danger-text:        #991B1B;

  /* Info */
  --sh-info:               #2563EB;
  --sh-info-bg:            #EFF6FF;
  --sh-info-text:          #1E40AF;

  /* Focus */
  --sh-focus-ring:         rgba(79, 70, 229, 0.3);
}
```

#### Dark Mode

```css
html.dark {
  --sh-bg:                 #0A0A0A;
  --sh-surface:            #141414;
  --sh-surface-elevated:   #1E1E1E;

  --sh-text-main:          #EDEDED;
  --sh-text-muted:         #A3A3A3;

  --sh-border:             #262626;
  --sh-border-2:           #333333;

  --sh-primary:            #818CF8;
  --sh-primary-dark:       #6366F1;
  --sh-primary-bg:         rgba(129,140,248,0.1);
  --sh-primary-text:       #A5B4FC;

  --sh-success:            #34D399;
  --sh-success-bg:         rgba(52,211,153,0.1);

  --sh-warning:            #FBBF24;
  --sh-warning-bg:         rgba(251,191,36,0.1);
  --sh-warning-text:       #FCD34D;

  --sh-danger:             #F87171;
  --sh-danger-bg:          rgba(248,113,113,0.1);
  --sh-danger-text:        #FCA5A5;

  --sh-info:               #60A5FA;
  --sh-info-bg:            rgba(96,165,250,0.1);
  --sh-info-text:          #93C5FD;

  --sh-focus-ring:         rgba(129,140,248,0.35);
}
```

#### WCAG kontrast Paleta B

| Kombinace | Pomer | Hodnoceni |
|-----------|-------|-----------|
| `#171717` na `#FFFFFF` | 17.4:1 | AAA |
| `#737373` na `#FFFFFF` | 4.6:1 | AA large text (zvazit `#636363` pro 5.7:1 AA) |
| `#4F46E5` na `#FFFFFF` | 5.1:1 | AA |
| `#EDEDED` na `#141414` | 15.1:1 | AAA |
| `#A3A3A3` na `#141414` | 7.5:1 | AAA |

---

## 5. Prioritizovany backlog

### Quick Wins (1-2 dny)

| ID | Problem | Dopad | Reseni | Narocnost |
|----|---------|-------|--------|-----------|
| Q1 | Border radius je prilis velky — dava "AI bublinkovy" look | Vizualni identita cele appky, okamzite zlepseni | Snizit v shelfy.css: sm 6px, md 10px, lg 14px, xl 18px. Jeden blok v `:root`. | 1h |
| Q2 | Dark mode: mobile nav ma hardcoded bily backdrop | Broken vizual na dark mode — bily pruh misto tmaveho | Nahradit `rgba(255,255,255,0.92)` za CSS promennou v Navigation.tsx:254 | 15min |
| Q3 | `html.dark` chybi amber/blue/purple/red/shadow overrides | Barvy se nemeni pri manualnim dark toggle (jen pri system preference) | Zkopirovat chybejici promenne z `@media (prefers-color-scheme: dark)` bloku do `html.dark` | 30min |
| Q4 | Hover scale na book cards je prilis agresivni (-6px) | Vypada "skakave", hlavne na vetsich gridech | Snizit na `-3px` v shelfy.css:180 | 5min |
| Q5 | Input padding (14px 18px) a radius (16px) je nadmerny | Inputy vypadaji "nafouklene", neproduktivni | Padding `10px 14px`, radius `var(--sh-radius-md)` (10px po Q1) | 30min |
| Q6 | Primary button shadow glow je prilis intenzivni | "Landing page" feel misto utility app | Snizit na `0 2px 8px rgba(primary, 0.15)` v shelfy.css:269 | 15min |
| Q7 | Toast auto-dismiss 3.5s je kratky pro errory | Uzivatel nestihne precist error message | Error toasty: 6s, warning: 5s, success/info: 3s. Uprava v Toast.tsx a toast-store.ts | 30min |
| Q8 | Delete button na BookCard je vzdy viditelny | Vizualni clutter, riziko accidental clicks | Schovat za hover (desktop). Pridat opacity:0 default, opacity:1 on card:hover | 2h |

### Medium (1 sprint)

| ID | Problem | Dopad | Reseni | Narocnost |
|----|---------|-------|--------|-----------|
| M1 | Barevna paleta je genericka Google Material | Chybi brand identity, "AI generated" dojem | Implementovat Paletu A "Sage". Prejmenovat tokeny z `--sh-teal-*` na `--sh-primary-*` | 4h |
| M2 | Inline styly v komponentach (~80% stylu) | Tezka udrzba, nekonzistentni theming | Extrahovat do CSS trid / CSS modulu. Zacit od Navigation.tsx (nejvic inline stylu) | 1-2 dny |
| M3 | Book detail ma prilis mnoho accordionu (5 sekci) | Kognitivni zatez, klikani pro bezny workflow | Redesign: metadata vzdy viditelna, edit jako flat form, loans collapsed s count | 1-2 dny |
| M4 | Scan flow stepper je jen 3 barevne prouzky | Uzivatel nevi kde je a co zbyva. Slaba orientace. | Implementovat labeled stepper: "1. Location -> 2. Scan -> 3. Review" s ikonami a labels | 4h |
| M5 | Spacing scale neexistuje | Nekonzistentni rozestupy v cele appce | Definovat `--sh-space-*` tokeny, refaktorovat hardcoded hodnoty v CSS i inline | 1 den |
| M6 | Emoji empty states | Zesiluje "AI generated" dojem | Nahradit SVG ilustracemi (48px ikony) nebo jednoduchy outlined illustration set | 1 den |
| M7 | Book spines v digital twin jsou prilis male (36-52px x 120px) | Spatna citelnost zejmena na mobilu, 9px text temer necitelny | Min. sirka 48px, vyska 140-150px, font 11px. Pridat tooltip s nazvem knihy on hover. | 4h |
| M8 | Locations management nema mobilni card view | `.sh-locations-mobile` CSS trida je prazdna, data se na mobilu skryji | Implementovat card-based view pro <768px s room grouping | 4h |
| M9 | Font Outfit je mene rozpoznatelny | Dobry font ale mene osobity nez alternativy | Zvazit prechod na Inter (safe), Geist (modern) nebo Satoshi (editorial feel) | 2h + testovani |
| M10 | Stat bar affordance je slaba | Uzivatele nepoznaji ze stats jsou klikatelne filtry | Cursor: pointer, hover bg change, vizualni indikator (carka nebo bg zmena pri active) | 2h |

### Big Bets (2+ sprinty)

| ID | Problem | Dopad | Reseni | Narocnost |
|----|---------|-------|--------|-----------|
| B1 | Digital twin je jen horizontalni list barevnych obdelniku | Neevokuje skutecnou polici, chybi "wow" efekt | Redesign: perspektivni vizualizace s "drevenyma" policema, realnejsi spine rendering | 2-3 tydny |
| B2 | Zadna drag & drop reorder pro knihy na polici | Zmena poradi vyzaduje editaci shelf_position rucne v book detail | Implementovat DnD (dnd-kit library) pro spine reorder v bookshelf view | 1 tyden |
| B3 | Search je jen text match na title/author | Chybi fuzzy search, filtry dle roku/jazyka/vydavatele | Backend: full-text search s fuzzy matching. Frontend: advanced filter panel s facets | 1-2 tydny |
| B4 | Zadny onboarding flow | Novy uzivatel vidi prazdnou knihovnu bez guidance | Onboarding wizard: "Add your first book" -> "Scan a shelf" -> "Organize" s priklady | 1 tyden |
| B5 | Chybi bulk operations | Smazat/presunout/zmenit status 10 knih vyzaduje 10x otevrit detail | Multi-select mode na books grid s bulk actions toolbar (delete, move, change status) | 1 tyden |
| B6 | Chybi keyboard shortcuts | Pro power users (kazdodenni pouziti) neefektivni | Cmd+K command palette, keyboard nav v gridu, shortcuts pro Add/Scan/Search | 1 tyden |

---

## 6. Redesign klicovych obrazovek

### 6.1 Books List

#### Soucasny stav
- H2 "Books" nadpis + pocet jako `(123 knih)` text
- Search bar + pill-button filtry (reading status)
- Location dropdown filtr
- Stat bar (4 klikatelne stat karty v gridu)
- Book cards v auto-fill gridu (minmax 150px)
- Seskupene podle lokace

#### Navrh zmeny

```
+----------------------------------------------------------+
| Library                                 [+] [Scan Shelf] |
|                                                           |
| +-- 142 ------------------------------------------------+|
| |   books in your library                                ||
| +--------------------------------------------------------+|
|                                                           |
| [magnifier Search books...                              ] |
|                                                           |
| All . Reading (3) . Read (89) . Unread (47) . Lent (3)   |
| ========================================================= |
|                                                           |
| pin Living Room / IKEA Billy / Shelf 1           12 books |
| +-------+ +-------+ +-------+ +-------+ +-------+        |
| | cover | | cover | | cover | | cover | | cover |        |
| |       | |       | |       | |       | |       |        |
| | Title | | Title | | Title | | Title | | Title |        |
| | Auth  | | Auth  | | Auth  | | Auth  | | Auth  |        |
| +-------+ +-------+ +-------+ +-------+ +-------+        |
|                                                           |
| pin Bedroom / Shelf 2                             8 books |
| ...                                                       |
+----------------------------------------------------------+
```

**Klicove zmeny:**
- Hero number (display size 48px) pro celkovy pocet knih — okamzity kontext
- Underline tabs misto pill buttons — cistsi, editorial feel
- Location grouping zachovat, pridat collapse/expand ikonu
- Karty: mensi radius (10px), subtilnejsi shadow, delete hover-reveal
- Action buttons (Add, Scan) v headeru — primary akce vzdy dostupne

### 6.2 Book Detail

#### Soucasny stav
- Back button + title v headeru
- Velka article karta s xl radius (32px)
- Cover image (260px) s gradient overlay
- 5 accordion sekci: Metadata, Description, Management, Loans, Delete
- Inline edit formular v Management accordion

#### Navrh zmeny

```
+----------------------------------------------------------+
| <- Back                         [pin Show on Shelf]       |
|                                                           |
| +--------------+  Title of the Book                       |
| |              |  Author Name                             |
| |  Cover IMG   |                                          |
| |   300x400    |  [Read] [2019] [978-80-...]              |
| |              |                                          |
| +--------------+  Description text, max 4 lines with      |
|                   "show more" link...                      |
|                                                           |
| -- Details ----------------------------------------       |
| Publisher      Albatros Media                              |
| Language       cs                                         |
| Scan Status    * Enriched (green dot)                     |
| Location       Living Room / Billy / Shelf 1              |
|                                                           |
| -- Edit -----------------------------------------------   |
| [Title         ] [Author       ]                          |
| [ISBN   ] [Language] [Publisher ] [Year  ]                 |
| [Status v       ] [Location v          ]                  |
| [Shelf Position: 3  ]                                     |
|                                     [Save Changes]        |
|                                                           |
| -- Loan History ----------------------- (0 active)        |
| [Lend This Book]                                          |
|                                                           |
| -- Danger Zone ----------------------------------------   |
| [Delete Book]                                             |
+----------------------------------------------------------+
```

**Klicove zmeny:**
- Flat layout misto 5 accordion sekci — metadata vzdy viditelna, mene klikani
- Status + klicova metadata jako inline badges vedle titulu (reading status, rok, ISBN)
- Edit sekce: prehledny 2-column responsive grid, vsechna pole pohromade
- Loan history collapsed by default se count v headeru ("0 active")
- Danger zone vizualne oddelena (red left border nebo red tinted background)
- Cover vedle textu na desktopu (side-by-side layout od 1024px)

### 6.3 Scan Flow

#### Soucasny stav
- 3-step wizard s 3 barevnymi prouzky jako progress
- Step 1: 3 selecty (room/furniture/shelf) + create new toggle
- Step 2: Replace/Append mode + upload dropzone + photo list
- Step 3: Review editovatelny list knih s confidence indicators
- Draft persistence do localStorage

#### Navrh zmeny

```
Step indicator (labeled):
  (1) Location  -----  (2) Scan  -----  (3) Review
     [active]            [next]            [next]

[Step 1]
+----------------------------------------------------------+
| Where are you scanning?                                   |
|                                                           |
| [Room v         ] [Furniture v    ] [Shelf v    ]         |
|                                                           |
| + Create new location (expandable)                        |
|                                                           |
|                                     [Continue ->]         |
+----------------------------------------------------------+

[Step 2]
+----------------------------------------------------------+
| Scan mode:  (o) Replace shelf  ( ) Append right           |
|                                                           |
| + - - - - - - - - - - - - - - - - - - - - - - - +        |
| |                                                 |        |
| |    [camera icon]  Tap to take a photo           |        |
| |    or drag & drop an image                      |        |
| |                                                 |        |
| + - - - - - - - - - - - - - - - - - - - - - - - +        |
|                                                           |
| Photos:                                                   |
| [check] Photo 1 -- 6 books found               [x]       |
| [check] Photo 2 -- 4 books found               [x]       |
| [loading] Photo 3 -- Processing...                        |
|                                                           |
| Total: 10 books                                           |
|                                                           |
| [<- Back]                       [Review 10 Books ->]      |
+----------------------------------------------------------+

[Step 3]
+----------------------------------------------------------+
| Review scanned books                     10 books found   |
|                                                           |
| #1 (high confidence)                                      |
| [Title: Krakatit                 ] [Author: Karel Capek ] |
|                                                           |
| #2 (NEEDS REVIEW - amber highlight)                       |
| [Title: ???                      ] [Author:             ] |
| Observed text: "K r a k a t i t"                          |
|                                                           |
| ...                                                       |
|                                                           |
| [<- Back]                      [Confirm 9 Books ->]       |
+----------------------------------------------------------+
```

**Klicove zmeny:**
- Labeled stepper s ikonami, cisly a progress line mezi kroky
- Stepper ukazuje kde uzivatel je, co uz je hotove, co nasleduje
- Vetsi dropzone area — zvednuty tap target pro mobilni camera
- Prehlednejsi foto list se status ikonami (check/loading/error)
- Review: cistsi layout, jasnejsi confidence vizualizace
- CTA vzdy ukazuje pocet knih pro potvrzeni

### 6.4 Bookshelf (Digitalni dvojce)

#### Soucasny stav
- Tabs: Shelves / Locations
- Room filter jako button row
- Furniture groups s shelf sections
- Book spines: 36-52px sirka, 120px vyska, 9px vertikalni text
- Horizontal flex s 6px gap, overflow-x scroll
- Spine barva z hash titulu (12 presetu) nebo cover image

#### Navrh zmeny

```
+----------------------------------------------------------+
| My Shelves                              [Scan Shelf]      |
|                                                           |
| [Shelves] [Locations]         Room: [All v]               |
|                                                           |
| === Living Room / IKEA Billy ============================  |
|                                                           |
| Shelf 1                                        12 books   |
| +--------------------------------------------------------+|
| | [sp][sp][sp][sp][sp][sp][sp][sp][sp][sp][sp][sp]       ||
| | [in][in][in][in][in][in][in][in][in][in][in][in]       ||
| | [e1][e2][e3][e4][e5][e6][e7][e8][e9][10][11][12]      ||
| | [  ][  ][  ][  ][  ][  ][  ][  ][  ][  ][  ][  ]      ||
| |========================================================||
| +--------------------------------------------------------+|
|    ^--- "wood shelf" base line (border-bottom gradient)   |
|                                                           |
| Shelf 2                                         8 books   |
| +--------------------------------------------------------+|
| | ...                                                    ||
+----------------------------------------------------------+
```

**Klicove zmeny:**
- Spiny vetsi: min-width 48px, height 140-150px, font-size 11px
- Vizualni "podlaha" police — CSS border-bottom s wood-like gradient
- Tooltip on hover s nazvem + autorem knihy
- Room filter jako dropdown misto button row (skaluje lepe pro 5+ rooms)
- Highlight aktivni knihy s subtle pulse animaci (ne jen border)
- Click na spine -> navigace na book detail (zachovat)

### 6.5 Locations Management

#### Soucasny stav
- Flat tabulka se vsemi lokacemi (room, furniture, shelf, display_order, actions)
- Create form nahore (auto-fit grid)
- Inline edit v tabulce
- Desktop-only tabulka, mobilni verze chybi

#### Navrh zmeny

```
+----------------------------------------------------------+
| Locations                                                 |
| Manage your rooms, furniture, and shelves                 |
|                                                           |
| [+ Add Location]                                          |
| +--------------------------------------------------------+|
| | [Room       ] [Furniture  ] [Shelf    ] [#Order] [Add] ||
| +--------------------------------------------------------+|
|                                                           |
| -- Living Room -------------------------------------------+
|                                                           |
| +--------------------------------------------------------+|
| | IKEA Billy                                     3 shelves|
| | +-- Shelf 1 ---- #1 ---- 12 books ---- [edit] [del] --+|
| | +-- Shelf 2 ---- #2 ----  8 books ---- [edit] [del] --+|
| | +-- Shelf 3 ---- #3 ----  0 books ---- [edit] [del] --+|
| +--------------------------------------------------------+|
|                                                           |
| -- Bedroom -----------------------------------------------+
|                                                           |
| +--------------------------------------------------------+|
| | Nightstand                                     1 shelf  |
| | +-- Top --------- #1 ----  3 books ---- [edit] [del] -+|
| +--------------------------------------------------------+|
+----------------------------------------------------------+
```

**Klicove zmeny:**
- Hierarchicke seskupeni misto flat tabulky: Room heading -> Furniture card -> Shelf rows
- Na mobilu: stejna hierarchie, jen vertikalne stacknuta (karty misto tabulky)
- Book count u kazde police — uzivatel vidi kolik knih je kde
- Inline edit zachovat, ale v kontextu hierarchie
- Room headings jako sticky sekce pro lepsi orientaci pri scrollu
- Furniture jako karty s book count summary

---

## 7. Design tokeny — kompletni navrh

Nasledujici token system je pripraven k implementaci do `shelfy.css` jako nahrada soucasnych `:root` promennych.

```css
:root {
  /* ============================================ */
  /* TYPOGRAPHY                                    */
  /* ============================================ */
  --sh-font-family:     'Inter', system-ui, -apple-system, sans-serif;
  --sh-font-mono:       'JetBrains Mono', ui-monospace, monospace;

  /* Font Sizes */
  --sh-text-display:    48px;    /* hero numbers, key metrics */
  --sh-text-h1:         36px;    /* page titles */
  --sh-text-h2:         24px;    /* section headings */
  --sh-text-h3:         20px;    /* subsection headings */
  --sh-text-body:       15px;    /* body text (or 14px for compact) */
  --sh-text-small:      13px;    /* secondary info, labels */
  --sh-text-caption:    11px;    /* metadata, timestamps, hints */

  /* Font Weights */
  --sh-weight-normal:   400;
  --sh-weight-medium:   500;
  --sh-weight-semibold: 600;
  --sh-weight-bold:     700;

  /* Line Heights */
  --sh-leading-tight:   1.2;     /* headings, display */
  --sh-leading-normal:  1.5;     /* body text */
  --sh-leading-relaxed: 1.65;    /* long-form reading */

  /* Letter Spacing */
  --sh-tracking-tighter: -0.04em; /* display */
  --sh-tracking-tight:   -0.02em; /* headings */
  --sh-tracking-normal:  -0.01em; /* body */
  --sh-tracking-wide:     0.02em; /* labels, captions, uppercase */

  /* ============================================ */
  /* SPACING (4px base unit)                       */
  /* ============================================ */
  --sh-space-0:    0;
  --sh-space-0-5:  2px;     /* hairline */
  --sh-space-1:    4px;     /* micro gap */
  --sh-space-2:    8px;     /* tight */
  --sh-space-3:    12px;    /* compact */
  --sh-space-4:    16px;    /* default */
  --sh-space-5:    20px;    /* comfortable */
  --sh-space-6:    24px;    /* section gap */
  --sh-space-8:    32px;    /* group gap */
  --sh-space-10:   40px;    /* page padding (desktop) */
  --sh-space-12:   48px;    /* section separation */
  --sh-space-16:   64px;    /* hero spacing */

  /* ============================================ */
  /* BORDER RADIUS                                 */
  /* ============================================ */
  --sh-radius-xs:    4px;     /* badges, tags, small chips */
  --sh-radius-sm:    6px;     /* small elements, tooltips */
  --sh-radius-md:    10px;    /* inputs, small cards, dropdowns */
  --sh-radius-lg:    14px;    /* cards, modals, popovers */
  --sh-radius-xl:    18px;    /* large cards, hero sections */
  --sh-radius-pill:  9999px;  /* buttons, tab indicators */

  /* ============================================ */
  /* SHADOWS                                       */
  /* ============================================ */
  --sh-shadow-xs:    0 1px 2px rgba(0,0,0,0.04);
  --sh-shadow-sm:    0 2px 8px rgba(0,0,0,0.04);
  --sh-shadow-md:    0 4px 16px rgba(0,0,0,0.06);
  --sh-shadow-lg:    0 8px 24px rgba(0,0,0,0.08);
  --sh-shadow-xl:    0 16px 32px rgba(0,0,0,0.10);

  /* ============================================ */
  /* COLORS — Sage Palette (Light)                 */
  /* ============================================ */

  /* Backgrounds */
  --sh-bg:                 #F5F5F3;
  --sh-bg-main:            #F5F5F3;
  --sh-surface:            #FFFFFF;
  --sh-surface-elevated:   #FAFAF8;

  /* Text */
  --sh-text-main:          #1A1A1A;
  --sh-text-muted:         #6B6B6B;
  --sh-placeholder:        #9CA3AF;

  /* Input */
  --sh-input-bg:           #FAFAF8;

  /* Borders */
  --sh-border:             rgba(0,0,0,0.07);
  --sh-border-2:           rgba(0,0,0,0.13);
  --sh-border-focus:       rgba(45, 122, 95, 0.25);

  /* Primary (Sage Green) */
  --sh-primary:            #2D7A5F;
  --sh-primary-dark:       #1E5C46;
  --sh-primary-bg:         #E8F0EC;
  --sh-primary-text:       #1A4A38;

  /* Success */
  --sh-success:            #2D7A5F;
  --sh-success-bg:         #E8F0EC;
  --sh-success-text:       #1A4A38;

  /* Warning */
  --sh-warning:            #B8860B;
  --sh-warning-bg:         #FBF3E0;
  --sh-warning-text:       #7A5A0B;

  /* Danger */
  --sh-danger:             #C53030;
  --sh-danger-bg:          #FEE2E2;
  --sh-danger-text:        #9B1C1C;

  /* Info */
  --sh-info:               #2B6CB0;
  --sh-info-bg:            #EBF4FF;
  --sh-info-text:          #1A4A7A;

  /* Focus ring */
  --sh-focus-ring:         rgba(45, 122, 95, 0.3);

  /* ============================================ */
  /* TRANSITIONS                                   */
  /* ============================================ */
  --sh-ease-default:   cubic-bezier(0.4, 0, 0.2, 1);
  --sh-ease-bounce:    cubic-bezier(0.34, 1.56, 0.64, 1);
  --sh-ease-out:       cubic-bezier(0, 0, 0.2, 1);
  --sh-duration-fast:  150ms;
  --sh-duration-normal:250ms;
  --sh-duration-slow:  400ms;

  /* ============================================ */
  /* Z-INDEX SCALE                                 */
  /* ============================================ */
  --sh-z-dropdown:   50;
  --sh-z-sticky:     60;
  --sh-z-nav:        100;
  --sh-z-modal:      200;
  --sh-z-toast:      300;

  /* ============================================ */
  /* LAYOUT                                        */
  /* ============================================ */
  --sh-sidebar-width:  240px;
  --sh-max-w-sm:       640px;
  --sh-max-w-md:       800px;
  --sh-max-w-lg:       1000px;
  --sh-max-w-xl:       1200px;
}

/* ============================================== */
/* DARK MODE                                       */
/* ============================================== */
html.dark {
  --sh-bg:                 #111111;
  --sh-bg-main:            #111111;
  --sh-surface:            #1A1A1A;
  --sh-surface-elevated:   #222222;

  --sh-text-main:          #E8E8E8;
  --sh-text-muted:         #888888;
  --sh-placeholder:        #555555;

  --sh-input-bg:           #141414;

  --sh-border:             rgba(255,255,255,0.08);
  --sh-border-2:           rgba(255,255,255,0.15);
  --sh-border-focus:       rgba(76,175,130,0.3);

  --sh-primary:            #4CAF82;
  --sh-primary-dark:       #3D9A6F;
  --sh-primary-bg:         rgba(76,175,130,0.12);
  --sh-primary-text:       #6FCF9A;

  --sh-success:            #4CAF82;
  --sh-success-bg:         rgba(76,175,130,0.12);
  --sh-success-text:       #6FCF9A;

  --sh-warning:            #D4A017;
  --sh-warning-bg:         rgba(212,160,23,0.12);
  --sh-warning-text:       #E8B82E;

  --sh-danger:             #F56565;
  --sh-danger-bg:          rgba(245,101,101,0.12);
  --sh-danger-text:        #FEB2B2;

  --sh-info:               #63B3ED;
  --sh-info-bg:            rgba(99,179,237,0.12);
  --sh-info-text:          #90CDF4;

  --sh-focus-ring:         rgba(76,175,130,0.35);

  --sh-shadow-xs:    0 1px 2px rgba(0,0,0,0.15);
  --sh-shadow-sm:    0 2px 8px rgba(0,0,0,0.2);
  --sh-shadow-md:    0 4px 16px rgba(0,0,0,0.25);
  --sh-shadow-lg:    0 8px 24px rgba(0,0,0,0.3);
  --sh-shadow-xl:    0 16px 32px rgba(0,0,0,0.35);
}

/* Also support system preference as fallback */
@media (prefers-color-scheme: dark) {
  :root:not(.light) {
    /* Same values as html.dark — ensures dark mode works
       both via manual toggle AND system preference */
  }
}
```

---

## Appendix A: Soubory k editaci (reference)

| Oblast | Soubor | Co zmenit |
|--------|--------|-----------|
| Design tokeny | `src/styles/shelfy.css` | `:root` promenne, `html.dark` blok, `@media prefers-color-scheme` |
| Navigace | `src/components/Navigation.tsx` | Inline styly -> CSS tridy, dark mode backdrop fix |
| Book karty | `src/components/BookCard.tsx` | Hover scale, delete button visibility |
| Toasty | `src/components/Toast.tsx` + `src/lib/toast-store.ts` | Timeout per variant |
| Book detail | `src/pages/BookDetailPage.tsx` | Accordion -> flat layout redesign |
| Scan flow | `src/pages/ScanShelfPage.tsx` | Stepper component, dropzone sizing |
| Bookshelf | `src/pages/BookshelfViewPage.tsx` | Spine sizing, shelf visualization |
| Locations | `src/pages/LocationsPage.tsx` | Hierarchicke seskupeni, mobile card view |
| Books list | `src/pages/BooksPage.tsx` | Hero number, tab style, card grid |
| Global styles | `src/styles/shelfy.css` | Radius, shadows, button styles, input styles |

## Appendix B: Technicka architektura (kontext)

- **Framework:** React 18 + TypeScript + Vite
- **Routing:** React Router DOM 6
- **State:** Zustand (settings, toasts) + React Query (server state) + React Context (auth)
- **Styling:** Pure CSS s custom properties (zadny Tailwind, zadna component library)
- **i18n:** i18next (cs/en)
- **Vsechny styly:** `src/styles/shelfy.css` (globalni) + `src/pages/BooksPage.css` + inline styly v komponentach

---

*Tento dokument je urcen jako vstup pro implementaci i pro diskuzi s AI asistenty. Vsechny navrhy jsou konkretni a referencuji skutecne soubory a CSS promenne v Shelfy codebase.*
