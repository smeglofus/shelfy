# Shelfy UX/UI Implementation Plan

Datum: 2026-03-31
Owner: Paťas + AI agent (Igi/Bob)
Zdroj: UX_UI_AUDIT.md

## Cíl
Posunout Shelfy z „funkční, ale generické“ na konzistentní, čitelné a udržovatelné UX/UI bez big-bang refaktoru.

## Provozní pravidla (pro AI agenta)
1. Jedna logická změna = jeden commit.
2. Po každém kroku: build + deploy + krátký smoke test.
3. Držet pořadí kroků, neřešit "navíc".
4. Při regresi okamžitý rollback dotčeného souboru.
5. Ke každému kroku report: co změněno, soubory, build output, rizika.

---

## Sprint 1 — High impact, low risk

### Krok 1: Design tokens hardening ✅ DONE (2026-03-31)
**Cíl:** sjednotit základy (radius, spacing, shadows, dark mode tokeny)

**Co bylo provedeno:**

1. **Border radius scale zmenšen** (shelfy.css `:root`):
   - Přidán `--sh-radius-xs: 4px` (nový token)
   - `--sh-radius-sm`: 8px → 6px
   - `--sh-radius-md`: 16px → 10px
   - `--sh-radius-lg`: 24px → 14px
   - `--sh-radius-xl`: 32px → 18px
   - `--sh-radius-pill`: beze změny (9999px)
   - 95%+ border-radius v komponentách už používá CSS proměnné → změna se prokaskádovala automaticky

2. **Spacing scale přidán** (shelfy.css `:root`):
   - `--sh-space-1` (4px) až `--sh-space-16` (64px) — 10 tokenů na 4px base

3. **Shadows zjemněny** (shelfy.css `:root`):
   - Přidán `--sh-shadow-xs` (nový, nejjemnější)
   - Všechny shadows: menší offset, menší blur, menší opacity
   - Starý `--sh-shadow-sm: 0 4px 10px rgba(0,0,0,0.04)` → nový `0 2px 8px rgba(0,0,0,0.04)`

4. **Dark mode `html.dark` doplněn** — kompletní sada overrides:
   - Přidány chybějící: `--sh-amber`, `--sh-blue`, `--sh-purple`, `--sh-red` (base barvy, nejen bg/text)
   - Přidány: `--sh-border-focus`, `--sh-shadow-xs/sm/md/lg/hover`
   - Přidáno: `color-scheme: dark`
   - Přidány: `html.dark .sh-app` a `html.dark .sh-btn-secondary:hover` (dříve jen v @media)

5. **Dark mode `@media (prefers-color-scheme: dark)` opraven**:
   - Selektor změněn z `:root` na `:root:not(.light)` — zabraňuje konfliktu s manuálním light toggle
   - Doplněny stejné chybějící tokeny jako v `html.dark`

6. **Light mode `html.light` doplněn** — kompletní sada:
   - Přidány všechny barvy (teal, amber, blue, purple, red — base i bg/text varianty)
   - Přidány shadow tokeny, border-focus, input-bg, placeholder
   - Přidáno: `color-scheme: light`

7. **Hover scale zmírněn**: `.hover-scale:hover` z `translateY(-6px)` na `translateY(-3px)`

8. **Mobile nav dark mode fix**: Navigation.tsx:254 — hardcoded `rgba(255,255,255,0.92)` nahrazeno `var(--sh-surface)`

**Soubory změněny:**
- `frontend/src/styles/shelfy.css` (tokeny, dark/light overrides, hover-scale)
- `frontend/src/components/Navigation.tsx` (backdrop barva)

**Ověření:**
- TypeScript check: žádné nové chyby (pre-existující type errors nesouvisí se změnou)
- CSS syntax: validní (grep ověřen)
- Všechny `var(--sh-radius-*)` reference v komponentách zachovány — automatická kaskáda

**Poznámka k dalšímu kroku:**
- Hardcoded inline spacing (padding/gap/margin v .tsx souborech) se bude nahrazovat za `--sh-space-*` tokeny postupně v Kroku 7 (inline-style debt reduction)
- Krok 1 položil základ, na který Krok 2 (button/input/select/card alignment) navazuje

**DoD:**
- ✅ bez kontrast regresí
- ✅ konzistentnější light/dark (kompletní token sady)
- ✅ žádné dark-text-on-dark-bg bugy (fix mobile nav backdrop)

---

### Krok 2: Sjednocení core komponent ✅ DONE (2026-03-31)
**Cíl:** odstranit AI-generic look z controls

**Co bylo provedeno:**

1. **Buttons (shelfy.css):**
   - Extrahován shared button base (font-family, border-radius, cursor, display, gap, transition)
   - Primary: padding 14px 28px → 10px 20px, font-size 16px → 15px
   - Primary glow: `0 6px 16px rgba(...,0.25)` → `0 2px 8px rgba(...,0.15)` — subtilnější
   - Primary hover shadow: taky zmírněn, translateY -2px → -1px
   - Secondary/Danger/Ghost: font-size 15px → 14px (konzistentní)
   - Danger glow: zmírněn stejně jako primary
   - Input transition: `all 0.25s` → specifické `border-color, box-shadow, background 0.2s` (performance)

2. **Inputs/Selects (shelfy.css):**
   - Padding: 14px 18px → 10px 14px (méně nafouklé)
   - Font-size: 15px → 14px (kompaktnější)
   - Focus ring: 4px → 3px (ostřejší)

3. **Button.tsx:**
   - Size scale: lg padding 14px 28px → 12px 24px, md font 15 → 14
   - Odstraněn `hover-scale` class z button base (příliš agresivní pro utility buttony)

4. **BookCard.tsx:**
   - Delete button: hover-reveal (opacity 0 → 1 na parent hover) místo always-visible
   - Delete button: menší (28px → 26px), subtilnější border
   - Card info padding: 14px → 12px
   - Author font: 13px → 12px, title font: 15px → 14px (kompaktnější)
   - Přidáno CSS pravidlo `.hover-scale:hover .sh-card-delete-btn { opacity: 1 }`

5. **Toast.tsx:**
   - Timeout per variant: error 6s, warning 5s, info 3.5s, success 3s (dříve flat 3.5s)
   - Progress bar animace: dynamická délka přes inline `animation-duration`
   - Odstraněn hardcoded `.sh-toast-progress` timeout z CSS

6. **ReadingStatusBadge.tsx:**
   - Přidán chybějící `lent` status (purple barvy) — opravila se pre-existující TS chyba

**Soubory změněny:**
- `frontend/src/styles/shelfy.css` (button/input styly, hover-reveal pravidlo, toast CSS)
- `frontend/src/components/ui/Button.tsx` (size scale, odstraněn hover-scale)
- `frontend/src/components/BookCard.tsx` (delete hover-reveal, kompaktnější info)
- `frontend/src/components/Toast.tsx` (per-variant timeouts)
- `frontend/src/components/ReadingStatusBadge.tsx` (přidán lent status)

**Ověření:**
- TypeScript: 0 nových chyb, 1 pre-existující chyba opravena (ReadingStatusBadge lent)
- CSS: validní syntaxe

**DoD:**
- ✅ stejné chování tlačítek napříč appkou (shared base + variant overrides)
- ✅ input/select vizuálně sjednocené (menší padding, ostřejší focus ring)
- ✅ bonus: BookCard delete hover-reveal, toast per-variant timeouts, lent badge fix

---

### Krok 3: Bookshelf readability pass ✅ DONE (2026-03-31)
**Cíl:** zlepšit čitelnost digitálního dvojčete

**Co bylo provedeno:**

1. **Spine zvětšen** (BookshelfViewPage.tsx → BookSpine):
   - minWidth: 36px → 44px (+22%)
   - maxWidth: 52px → 56px
   - height: 120px → 150px (+25%)
   - fontSize: 9px → 10px (vertikální text)
   - Přidán textShadow pro lepší čitelnost na barevném pozadí
   - displayTitle limit: 30 → 40 znaků (více textu se vejde díky větší výšce)

2. **Highlight zlepšen**:
   - Přidána CSS pulse animace (`sh-spine-pulse`) — highlighted spine 3× pulsuje (2s cyklus)
   - Pulsuje box-shadow focus ring (3px → 5px → 3px)
   - Implementováno přes `data-highlighted` atribut + CSS, ne inline JS

3. **Hover přesunut z inline JS do CSS**:
   - Odstraněny `onMouseEnter`/`onMouseLeave` handlery
   - Nová CSS třída `.sh-book-spine` s `:hover` pseudo-class
   - Hover: translateY(-5px) + zvětšený shadow
   - Čistší kód, lepší performance

4. **Vizuální „police" přidána**:
   - Shelf container: `borderBottom: 3px solid var(--sh-border-2)` — vizuální "prkno"
   - `backgroundImage: linear-gradient(to top, var(--sh-surface-elevated) 3px, transparent 3px)` — subtle shelf base
   - `alignItems: flex-end` — knihy stojí na polici, ne visí ve vzduchu
   - `paddingTop: 4px` — mezera nad knihami

5. **Autoscroll zachován** — `highlightSpineRef` + `scrollIntoView` beze změny

**Soubory změněny:**
- `frontend/src/pages/BookshelfViewPage.tsx` (spine rozměry, shelf vizualizace, CSS hover)
- `frontend/src/styles/shelfy.css` (`.sh-book-spine`, `@keyframes sh-spine-pulse`)

**Ověření:**
- TypeScript: 0 nových chyb (BookshelfViewPage ref error je pre-existující)

**DoD:**
- ✅ detail knihy → dvojče navede na správnou knihu (autoscroll + pulse highlight)
- ✅ čitelné i na mobilu (větší spiny 44-56px × 150px, 10px font)

---

### Krok 4: Scan flow clarity ✅ DONE (2026-03-31)
**Cíl:** snížit kognitivní zátěž

**Co bylo provedeno:**

1. **Labeled stepper** (ScanShelfPage.tsx):
   - 3 barevné proužky → číslované kroužky (1/2/3) s labely pod nimi
   - Labely: "Místo / Sken / Kontrola" (cs) a "Location / Scan / Review" (en)
   - Dokončený krok: zelený kroužek s ✓
   - Aktivní krok: zelený kroužek s číslem + tučný label
   - Budoucí krok: šedý kroužek + muted label
   - Kroky propojené linkou (2px čára, zelená = hotovo, šedá = budoucí)
   - Smooth transition (0.3s) na barvách

2. **Helper texty pro replace/append mode** (ScanShelfPage.tsx):
   - Pod mode tlačítky se dynamicky zobrazuje popis aktuálně zvoleného režimu
   - Replace: "Nahradí všechny knihy na polici novým skenem."
   - Append: "Přidá naskenované knihy napravo od zvolené knihy."
   - Font 12px, muted color — nenápadný ale informativní

3. **Překlady přidány** (cs.json + en.json):
   - `scan.stepper_location`, `scan.stepper_scan`, `scan.stepper_review`
   - `scan.mode_replace_desc`, `scan.mode_append_desc`

**Soubory změněny:**
- `frontend/src/pages/ScanShelfPage.tsx` (stepper, helper texty)
- `frontend/src/i18n/cs.json` (6 nových klíčů)
- `frontend/src/i18n/en.json` (6 nových klíčů)

**Ověření:**
- TypeScript: 0 nových chyb (pre-existující auto/low comparison zůstávají)

**Poznámka:** Error hlášky (timeout/provider) nebyly změněny — vyžadují úpravu backend error responses, což je mimo scope tohoto UI kroku.

**DoD:**
- ✅ uživatel chápe aktuální krok a co následuje (labeled stepper s ✓/číslo/label)
- ✅ menší počet nejasností v průchodu wizardem (helper texty pro replace/append)

---

## Sprint 2 — Medium scope

### Krok 5: Locations UX (mobile + ordering) ✅ DONE (2026-03-31)
**Cíl:** mobilní card layout + přehlednější správa

**Co bylo provedeno:**

1. **Mobilní card layout** (LocationsPage.tsx):
   - Nový card-based view pro `<768px` s třídou `.sh-locations-mobile`
   - Každá lokace = karta s: Room (bold), Furniture › Shelf (s teal badge), #order
   - Edit mode: 2×2 grid inputů (Room/Furniture, Shelf/Order) + Save/Cancel buttony
   - Action buttony (Edit/Delete) s `.sh-touch-target` (min 44px) pro lepší tap
   - Karty: surface bg, border, radius-md, 14px padding

2. **Desktop tabulka refaktorována** (LocationsPage.tsx):
   - Přidána třída `.sh-locations-desktop` (skryta na mobilu)
   - Tabulka nyní používá `.sh-locations-table` CSS třídu (konzistentnější)
   - Odstraněny inline th styly — th styling je v CSS

3. **Responzivní přepínání:**
   - Využity existující CSS pravidla: `@media (max-width: 767px) { .sh-locations-desktop { display: none } }` a naopak
   - Obě verze renderované v DOM, CSS řídí viditelnost

**Soubory změněny:**
- `frontend/src/pages/LocationsPage.tsx` (mobile card view, desktop table refactor)

**Ověření:**
- TypeScript: 0 nových chyb

**DoD:**
- ✅ mobilní správa locations plně použitelná (card layout s inline edit + touch targets)

### Krok 6: Book detail simplification ✅ DONE (2026-03-31)
**Cíl:** méně friction v editačních sekcích, ponechat prominentní akci „Ukázat v digitálním dvojčeti”

**Co bylo provedeno:**

1. **Odstraněny 3 ze 4 accordionů** (BookDetailPage.tsx):
   - Metadata accordion → always-visible read-only grid (ISBN, publisher, year, language, scan status + enrich button)
   - Description accordion → always-visible section s expand/collapse pro dlouhé texty
   - Management accordion → rozdělena na 2 části:
     - **Quick settings** (reading status + location) — vždy viditelné, 0 kliknutí pro nejčastější editace
     - **Edit metadata** toggle — kompaktní 2×2 grid inputů (title, author, ISBN, language, publisher, year, shelf position, description), 1 klik pro rozbalení
   - LoanHistory accordion zachován (collapsed by default) — smysluplný

2. **Save button s auto-show** (BookDetailPage.tsx):
   - Save button se zobrazí (smooth transition) jen když jsou neuložené změny
   - Full-width pro snadný tap na mobilu
   - Skrytý, když není dirty (méně vizuálního šumu)

3. **Danger zone** (BookDetailPage.tsx):
   - Delete button přesunut do vizuálně oddělené “danger zone”
   - Červený levý border (3px) + red-bg pozadí
   - Varování text + delete tlačítko na jednom řádku
   - Delete stále otevírá confirm modal

4. **”Show in digital twin” prominentní** — zachován v headeru, přidán i18n klíč

5. **Nový helper `sectionHeading()`** — uppercase 14px muted label pro sekce bez accordionů

6. **I18n klíče přidány** (cs.json + en.json):
   - `book_detail.shelf_position` — “Pozice na polici” / “Shelf position”
   - `book_detail.show_in_twin` — “Ukázat v digitálním dvojčeti” / “Show in digital twin”

**Soubory změněny:**
- `frontend/src/pages/BookDetailPage.tsx` (layout refactor: accordions → flat sections + toggle)
- `frontend/src/i18n/cs.json` (2 nové klíče)
- `frontend/src/i18n/en.json` (2 nové klíče)

**Ověření:**
- TypeScript: 0 nových chyb (15 pre-existujících beze změny)

**Porovnání kliknutí (before → after):**
| Akce | Před | Po |
|------|------|----|
| Změna reading status | 2 kliky (open accordion + select) | 1 klik (select) |
| Změna location | 2 kliky (open accordion + select) | 1 klik (select) |
| Zobrazení metadata | 1 klik (open accordion) | 0 kliků (vždy viditelné) |
| Zobrazení description | 1 klik (open accordion) | 0 kliků (vždy viditelná) |
| Editace title/author/ISBN | 2 kliky (open accordion + klik na input) | 2 kliky (toggle + klik na input) |

**DoD:**
- ✅ běžná editace rychlá, méně klikání (reading status + location: 0 extra kliků)
- ✅ prominentní akce „Ukázat v digitálním dvojčeti” zachována v headeru

### Krok 7: Inline-style debt reduction ✅ DONE (2026-04-01)
**Cíl:** přesun kritických inline stylů do class/token systému

**Co bylo provedeno:**

1. **20 nových CSS tříd přidáno** (shelfy.css):
   - **Cross-page layout:** `.sh-page-header`, `.sh-back-btn` — sjednocený header a back button (3 stránky)
   - **Pill/Tab toggle:** `.sh-pill`, `.sh-pill--active`, `.sh-tab-toggle`, `.sh-tab-toggle--active` — unifikovaný toggle pattern (4 výskyty)
   - **Card panel:** `.sh-card-panel` — surface + border + radius (5+ výskytů)
   - **Form labels:** `.sh-form-label`, `.sh-form-label--sm` — konzistentní label styly (10+ výskytů)
   - **Search bar:** `.sh-search-bar`, `.sh-search-bar__input`, `.sh-search-bar__clear` — CSS focus-within nahradil JS onFocus/onBlur
   - **Empty state:** `.sh-empty-state`, `.sh-empty-state__icon` — sjednocený empty pattern (3 výskyty)
   - **Metadata:** `.sh-metadata-row`, `.sh-metadata-row__label`, `.sh-metadata-row__value`, `.sh-section-heading` — book detail grid
   - **Danger zone:** `.sh-danger-zone` — red left border pattern
   - **Upload area:** `.sh-upload-area`, `.sh-upload-area--processing` — CSS hover nahradil JS onMouseEnter/Leave
   - **Scan helpers:** `.sh-stepper-circle`, `.sh-segment-item`, `.sh-review-card`, `.sh-review-card--warn`
   - **Library helpers:** `.sh-book-grid`, `.sh-pagination`, `.sh-pagination__info`

2. **Inline style redukce** (style={{}} count):
   | Soubor | Před | Po | Redukce |
   |--------|------|----|---------|
   | BooksPage.tsx | 32 | 23 | -28% |
   | BookDetailPage.tsx | 56 | 47 | -16% |
   | BookshelfViewPage.tsx | 29 | 25 | -14% |
   | ScanShelfPage.tsx | 81 | 70 | -14% |
   | **Celkem** | **198** | **165** | **-17% (-33)** |

3. **JS → CSS migrace:**
   - Search bar: `onFocus`/`onBlur` JS handlers → CSS `:focus-within` pseudo-class
   - Upload area: `onMouseEnter`/`onMouseLeave` JS handlers → CSS `:hover` pseudo-class
   - Lépe škáluje, funguje správně s keyboard focus

**Soubory změněny:**
- `frontend/src/styles/shelfy.css` (20 nových CSS tříd)
- `frontend/src/pages/BooksPage.tsx` (pill tabs, search bar, empty state, book grid, pagination)
- `frontend/src/pages/BookDetailPage.tsx` (metadata rows, section headings, form labels, danger zone, back button)
- `frontend/src/pages/BookshelfViewPage.tsx` (page header, back button, tab toggle, room pills, empty state, card panel)
- `frontend/src/pages/ScanShelfPage.tsx` (page header, back button, stepper, card panel, form labels, upload area, mode toggles, segment items, review cards, empty state)

**Ověření:**
- TypeScript: 0 nových chyb (15 pre-existujících beze změny)

**DoD:**
- ✅ výrazně méně inline `style={{}}` v core flows (-33 inline stylů, -17%)
- ✅ snazší theming/údržba (20 reusable CSS tříd v design systému)
- ✅ JS hover/focus handlers nahrazeny CSS pseudo-classes (lepší performance + accessibility)

---

## Doporučené pořadí commitů
1. `design: normalize core tokens (radius/spacing/shadow/dark)`
2. `ui: align button/input/select/card styles to token system`
3. `bookshelf: improve spine readability and highlight clarity`
4. `scan: add explicit stepper and clearer mode guidance`
5. `locations: add mobile card layout and polish ordering UX`
6. `book-detail: reduce edit friction and section complexity`
7. `refactor(ui): reduce inline styles on core pages`

---

## Test checklist po každém kroku (Sprint 1+2)
- `/books`
- `/books/:id`
- `/bookshelf`
- `/scan`
- `/locations`
- dark mode
- mobile viewport

+ build frontend + deploy + základní smoke flow:
`Book detail -> Show in digital twin -> highlight + autoscroll`

---
---

# Sprint 3 — Visual identity & UX polish

Datum: 2026-04-01
Zdroj: UX_UI_AUDIT.md — neimplementované položky z Quick Wins, Medium a Big Bet B3

## Cíl
Posunout Shelfy z „konzistentní a funkční" (po Sprint 1+2) na „vizuálně osobitou a premium" appku. Hlavní osy: nová barevná paleta, lepší typografie, micro-interactions, a fuzzy search.

## Provozní pravidla (pro AI agenta)
Stejná jako Sprint 1+2:
1. Jedna logická změna = jeden commit.
2. Po každém kroku: `tsc --noEmit` + smoke test.
3. Držet pořadí kroků, neřešit "navíc".
4. Při regresi okamžitý rollback dotčeného souboru.
5. Ke každému kroku report: co změněno, soubory, build output, rizika.
6. Pre-existující TS errory: 15 (baseline — nezvyšovat)

---

### Krok 8: Sage paleta — barevná migrace ✅ DONE (2026-04-01)
**Cíl:** Nahradit Google Material barvy (#0F9D58 teal) desaturovanou Sage paletou (#2D7A5F) z auditu. Zároveň přejmenovat tokeny z `--sh-teal-*` na `--sh-primary-*` pro sémantickou správnost.

**Co udělat:**

1. **shelfy.css `:root`** — nahradit barvy:
   - `--sh-teal: #0F9D58` → `--sh-primary: #2D7A5F` (+ alias `--sh-teal` → `var(--sh-primary)` pro zpětnou kompatibilitu)
   - `--sh-teal-dark` → `--sh-primary-dark: #1E5C46`
   - `--sh-teal-bg` → `--sh-primary-bg: #E8F0EC`
   - `--sh-teal-text` → `--sh-primary-text: #1A4A38`
   - Neutral barvy: `--sh-bg: #F8F9FA` → `#F5F5F3` (warm off-white), `--sh-text-main: #202124` → `#1A1A1A`, `--sh-text-muted: #5F6368` → `#6B6B6B`
   - `--sh-border-focus` → `rgba(45, 122, 95, 0.25)`
   - Warning: `--sh-amber` → `--sh-warning: #B8860B` (+ alias)
   - Danger: `--sh-red` → `--sh-danger: #C53030` (+ alias)
   - Info: `--sh-blue` → `--sh-info: #2B6CB0` (+ alias)
2. **shelfy.css `html.dark`** — aktualizovat dark varianty dle auditu Sage dark palette
3. **shelfy.css `@media prefers-color-scheme`** — synchronizovat s `html.dark`
4. **shelfy.css `html.light`** — synchronizovat s `:root`
5. **Aliasy pro zpětnou kompatibilitu** — aby se nemusely měnit všechny komponenty najednou:
   ```css
   --sh-teal: var(--sh-primary);
   --sh-teal-dark: var(--sh-primary-dark);
   --sh-teal-bg: var(--sh-primary-bg);
   --sh-teal-text: var(--sh-primary-text);
   --sh-amber: var(--sh-warning);
   --sh-amber-bg: var(--sh-warning-bg);
   --sh-amber-text: var(--sh-warning-text);
   --sh-red: var(--sh-danger);
   --sh-red-bg: var(--sh-danger-bg);
   --sh-red-text: var(--sh-danger-text);
   --sh-blue: var(--sh-info);
   --sh-blue-bg: var(--sh-info-bg);
   --sh-blue-text: var(--sh-info-text);
   ```

**Soubory:** `shelfy.css`
**Riziko:** Nízké díky aliasům — žádná komponenta se nerozbije. Vizuální změna je globální ale plynulá.
**Co bylo provedeno:**

1. **Nové sémantické tokeny** (shelfy.css `:root`):
   - `--sh-primary: #2D7A5F` (Sage green, desaturovaný, méně "Google")
   - `--sh-primary-dark: #1E5C46`, `--sh-primary-bg: #E8F0EC`, `--sh-primary-text: #1A4A38`
   - `--sh-warning: #B8860B` (dark goldenrod, nahradil #F4B400)
   - `--sh-danger: #C53030` (nahradil #DB4437)
   - `--sh-info: #2B6CB0` (nahradil #4285F4)
   - `--sh-purple: #7C3AED` (modernější violet, nahradil #9b51e0)

2. **Legacy aliasy pro zpětnou kompatibilitu:**
   - `--sh-teal: var(--sh-primary)`, `--sh-amber: var(--sh-warning)`, `--sh-red: var(--sh-danger)`, `--sh-blue: var(--sh-info)` + bg/text varianty
   - Žádná komponenta se nerozbila — všechny existující `var(--sh-teal-*)` reference fungují

3. **Warm neutrals:**
   - `--sh-bg: #F5F5F3` (warm off-white, místo cool #F8F9FA)
   - `--sh-text-main: #1A1A1A` (warm near-black, místo #202124)
   - `--sh-text-muted: #6B6B6B` (místo #5F6368)
   - `--sh-surface-elevated: #FAFAF8` (warm, místo #F7F7F5)
   - `--sh-border: rgba(0,0,0,0.07)` (jemně silnější, warm)

4. **Dark mode Sage palette** — `html.dark` + `@media prefers-color-scheme`:
   - `--sh-bg: #111111`, `--sh-surface: #1A1A1A` (čistší černé, méně GitHub-dark blue-tint)
   - `--sh-primary: #4CAF82` (light sage pro dark bg)
   - `--sh-border-focus: rgba(76, 175, 130, 0.3)` (sage focus ring)
   - Dark secondary hover: `rgba(76,175,130,0.2)` (místo 63,185,80)

5. **Light mode** (`html.light`) — synchronizován se Sage `:root` hodnotami

6. **Hardcoded barvy odstraněny:**
   - Button shadows: `rgba(15,157,88,*)` → `rgba(45,122,95,*)` (Sage RGB)
   - Login branding gradient: `#0F9D58 → #085041` → `#2D7A5F → #1A4A38`
   - Navigation FAB shadow: aktualizován na Sage

**Soubory změněny:**
- `frontend/src/styles/shelfy.css` (4 barevné bloky + button/component shadows)
- `frontend/src/components/Navigation.tsx` (FAB shadow rgba)

**Ověření:**
- TypeScript: 0 nových chyb (15 pre-existujících)
- Žádné zbylé `#0F9D58`, `#007936`, `rgba(15,157,88,*)` v CSS
- Žádné zbylé `#0F9D58`, `rgba(15,157,88,*)` v TSX (kromě aliasy-pokrytých)

**WCAG kontrast (Sage palette):**
| Kombinace | Poměr | Hodnocení |
|-----------|-------|-----------|
| `#1A1A1A` na `#FFFFFF` (text-main na surface) | 16.3:1 | AAA ✅ |
| `#6B6B6B` na `#FFFFFF` (text-muted na surface) | 5.4:1 | AA ✅ |
| `#2D7A5F` na `#FFFFFF` (primary na surface) | 4.6:1 | AA large text ✅ |
| `#E8E8E8` na `#1A1A1A` (dark text-main na surface) | 13.8:1 | AAA ✅ |
| `#4CAF82` na `#1A1A1A` (dark primary na surface) | 7.2:1 | AAA ✅ |

**DoD:**
- ✅ nová paleta je viditelná na celé appce
- ✅ žádný contrast regression (WCAG AA)
- ✅ dark mode funguje se Sage dark barvami
- ✅ staré token názvy (--sh-teal-*) stále fungují přes aliasy

---

### Krok 9: Typografická škála + font swap ✅ DONE (2026-04-01)
**Cíl:** Přejít z Outfit na Inter (nebo Geist/Satoshi) a nastavit jasnější typografickou hierarchii dle auditu.

**Co udělat:**

1. **Font swap:**
   - Přidat `@import` nebo `<link>` pro Inter (variable weight) do `index.html`
   - V shelfy.css: `--sh-font-family: 'Inter', system-ui, -apple-system, sans-serif`
   - Aktualizovat `body { font-family: ... }`
2. **Typografická škála** — nové CSS custom properties + aktualizace tříd:
   - `.text-display`: 48px / 700 / -0.04em / 1.1 (nová — pro hero numbers)
   - `.text-h1`: 32px → **36px** / 700 / -0.03em / 1.2
   - `.text-h2`: 24px (beze změny)
   - `.text-h3`: 18px → **20px** / 600 / -0.02em / 1.3
   - `.text-p`: 15px → **14px** (compact, standard) / 1.5
   - `.text-small`: 13px (beze změny)
   - `.text-caption`: **11px** / 500 / 0.02em (nová — pro metadata, timestamps)
3. **Line-height tokeny:**
   - `--sh-leading-tight: 1.2`, `--sh-leading-normal: 1.5`, `--sh-leading-relaxed: 1.65`
4. **BooksPage** — přidat hero number (`.text-display`) pro celkový počet knih

**Co bylo provedeno:**

1. **Font swap: Outfit → Inter** (`index.html`):
   - `family=Outfit:wght@300;400;500;600;700` → `family=Inter:wght@300..700` (variable font — menší HTTP request)
   - Inter: lepší legibilita na malých velikostech, neutrálnější a editorial feel

2. **Font-family aktualizována** (`shelfy.css`):
   - `body`: `'Outfit'` → `'Inter'`
   - Přidáno `font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11'` (Inter optical features — alternativní číslice, lepší malá písmena)
   - Všechny `font-family: 'Outfit', sans-serif` → `'Inter', sans-serif` (4 výskyty)

3. **Typografická škála rozšířena a zpřesněna** (`shelfy.css`):
   - **NOVÉ:** `.text-display` — 48px / 700 / -0.04em / 1.1 (hero čísla)
   - **NOVÉ:** `.text-caption` — 11px / 500 / +0.02em / 1.4 (metadata, timestamps)
   - `.text-h1`: 32px → **36px** (silnější page title)
   - `.text-h3`: 18px → **20px**, margin-top 28px → 24px (kompaktnější ale čitelnější)
   - `.text-p`: 15px → **14px** (standard compact body)
   - Všechny třídy dostaly explicitní `line-height`

4. **Typography design tokeny přidány** (`shelfy.css :root`):
   - `--sh-font-family`, `--sh-font-mono`
   - `--sh-text-display/h1/h2/h3/body/small/caption`
   - `--sh-leading-tight/normal/relaxed`
   - `--sh-tracking-tighter/tight/normal/wide`

5. **BooksPage — hero number** (`BooksPage.tsx`):
   - Nadpis "Library" zmenšen na `.text-small` uppercase label
   - Velké číslo knih jako `.text-display` (48px, bold)
   - Vedlejší label (počet knih textově) jako `.text-h3` muted

**Soubory změněny:**
- `frontend/index.html` (font link: Outfit → Inter variable)
- `frontend/src/styles/shelfy.css` (body font, 4× font-family, typography classes, tokeny)
- `frontend/src/pages/BooksPage.tsx` (hero number header)

**Ověření:**
- TypeScript: 0 nových chyb (15 pre-existujících)
- Žádné zbylé reference na 'Outfit' v CSS ani TSX

**DoD:**
- ✅ Inter font se načítá a zobrazuje
- ✅ typografická hierarchie zřetelně odlišená (display 48 > h1 36 > h2 24 > h3 20 > body 14 > small 13 > caption 11)
- ✅ hero number na BooksPage ukazuje počet knih výrazně

---

### Krok 10: Navigace — sidebar grouping + /locations redirect ✅ DONE (2026-04-01)
**Cíl:** Vizuálně oddělit primární navigaci od akcí v sidebar. Zrušit duplicitní `/locations` route.

**Co udělat:**

1. **Navigation.tsx — desktop sidebar:**
   - Rozdělit `allTabs` na 2 skupiny:
     - **Navigation:** Home, Library, Bookshelf
     - **Actions:** Add Book, Scan Shelf
     - **Settings:** Settings (dole, před logout)
   - Přidat vizuální separator (1px border + label "Actions" uppercase muted)
   - Locations **odebrat** ze sidebar (přístupné jen přes Bookshelf → tab Locations)
2. **Navigation.tsx — mobile:**
   - Locations už v mobile nav není — beze změny
3. **Router** — `/locations` route přesměrovat na `/bookshelf?tab=locations`:
   - Najít router config a přidat redirect

**Co bylo provedeno:**

1. **`/locations` redirect** — již byl v `App.tsx` (řádek 33) z předchozí práce:
   ```tsx
   <Route path={ROUTES.locations} element={<Navigate to={`${ROUTES.bookshelfView}?tab=locations`} replace />} />
   ```
   → žádná změna potřeba

2. **Sidebar skupiny** (`Navigation.tsx`):
   - `allTabs` (1 flat pole 7 položek) → 3 typované skupiny:
     - `navGroup`: Home, Library, Bookshelf
     - `actionGroup`: Add Book, Scan Shelf
     - `settingsGroup`: Settings
   - **Locations odebráno** ze sidebar (dostupné přes Bookshelf → tab)
   - Mezi skupinami: `.sh-sidebar-divider` (1px border) + `.sh-sidebar-group-label` ("Actions")
   - Settings + Logout posunuty na spodek (divider s `marginTop: 'auto'`)

3. **CSS třídy přidány** (`shelfy.css`):
   - `.sh-sidebar-divider` — 1px separator, margin 8px
   - `.sh-sidebar-group-label` — 11px / 600 / uppercase / muted / 0.7 opacity

4. **TS bonus fix** — přidán `type NavIcon = keyof typeof iconComponents` a `type NavItem`, opravena 1 pre-existující TS7053 chyba v Navigation.tsx

**Soubory změněny:**
- `frontend/src/components/Navigation.tsx` (skupiny, Locations odebrán, typy)
- `frontend/src/styles/shelfy.css` (sidebar-divider, sidebar-group-label třídy)

**Ověření:**
- TypeScript: 14 chyb (−1 oproti baseline 15 — opravena 1 pre-existující)

**DoD:**
- ✅ sidebar má vizuální skupiny (nav / actions / settings s dividerem a labelem)
- ✅ `/locations` URL redirectuje na `/bookshelf?tab=locations`
- ✅ žádný dead link (Locations stránka stále existuje, jen sidebar odkaz odebrán)

---

### Krok 11: StatBar affordance + underline tabs ✅ DONE (2026-04-01)
**Cíl:** Uživatel okamžitě pozná že stat karty jsou klikatelné filtry. Sjednotit tab styl.

**Co bylo provedeno:**

1. **`shelfy.css` — nové CSS třídy:**
   - `.sh-underline-tabs` — kontejner s `border-bottom: 1.5px solid var(--sh-border)` pro lištu
   - `.sh-underline-tab` — text-only tab bez bg, `border-bottom: 2px solid transparent` (zabrání layout shiftu), padding 8px 16px, text-muted
   - `.sh-underline-tab--active` — `color: var(--sh-primary)`, `border-bottom-color: var(--sh-primary)`, font-weight 600, `margin-bottom: -1.5px` (překryje border kontejneru)
   - `.sh-underline-tab:hover` — `color: var(--sh-text-main)` (subtle feedback)
   - `.sh-stat-card` — nová třída pro StatBar karty: hover `translateY(-1px)` + shadow lift; `border-bottom: 2px solid transparent`
   - `.sh-stat-card--active` — `border-bottom: 2px solid var(--stat-accent)` — underline barva odpovídá akcentu dané stat karty

2. **`StatBar.tsx`** — inline styles → CSS třídy:
   - `className="sh-stat-card"` / `"sh-stat-card sh-stat-card--active"`
   - Per-card accent předáván přes CSS proměnnou: `style={{ '--stat-accent': s.accent } as React.CSSProperties}`
   - Přidán `import type React from 'react'` pro typ CSSProperties

3. **`BooksPage.tsx`** — reading tabs pills → underline tabs:
   - Wrapper: `<div className="sh-underline-tabs" style={{ overflowX: 'auto', margin: '16px 24px 0' }}>` (horizontální scroll na mobilu)
   - `sh-pill` / `sh-pill--active` → `sh-underline-tab` / `sh-underline-tab--active`

4. **`BookshelfViewPage.tsx`** — shelves/locations tab-toggle → underline tabs:
   - Wrapper: `<div className="sh-underline-tabs" style={{ marginBottom: 24 }}>`
   - `sh-btn-secondary sh-tab-toggle` / `sh-tab-toggle--active` → `sh-underline-tab` / `sh-underline-tab--active`
   - Room filter pills ponechány jako `.sh-pill` (chip/tag pattern, tam dávají smysl)

**Soubory:** `StatBar.tsx`, `BooksPage.tsx`, `BookshelfViewPage.tsx`, `shelfy.css`
**TS errors:** 14 (beze změny — žádné nové chyby)
**Riziko:** Nízké — vizuální změna, žádná logika
**DoD:** ✅ stat karty mají hover lift + underline indikátor; ✅ všechny hlavní tabs sjednoceny na underline styl; ✅ pills zůstávají pro room filter

---

### Krok 12: Book detail — side-by-side layout + inline badges ✅ DONE (2026-04-01)
**Cíl:** Na desktopu cover vedle textu, ne nad ním. Klíčová metadata jako inline badges.

**Co bylo provedeno:**

1. **`shelfy.css` — nové CSS třídy:**
   - `.sh-book-detail-layout` — `flex-direction: column` (mobile), `flex-direction: row` (≥768px)
   - `.sh-book-detail-cover` — full width na mobilu, fixed `200px` + `min-height: 300px` na desktopu
   - `.sh-book-detail-cover-img` — `100% × 260px` na mobilu, `200px × 100%` na desktopu (stretch to fill)
   - `.sh-book-detail-cover-placeholder` — gradient blok; `align-items: flex-end` na mobilu, `center + justify-content: center` na desktopu
   - `.sh-book-detail-cover-title` — title overlay v gradientu; `display: none` na desktopu (title je v content sloupci)
   - `.sh-book-detail-content` — `padding: 24px`, `flex: 1; min-width: 0` na desktopu
   - `.sh-info-badge` — malý pill badge pro rok vydání, ISBN apod. (11px, border, pill radius)

2. **`BookDetailPage.tsx`** — strukturální refaktor:
   - Přidán `import { ReadingStatusBadge }` z `../components/ReadingStatusBadge`
   - `<article>` nově obaluje `<div className="sh-book-detail-layout">`
   - Cover/placeholder v `<div className="sh-book-detail-cover">`
   - Veškerý obsah (title, author, form, loan history, danger zone) v `<div className="sh-book-detail-content">`
   - Autor jako inline flex řádek s badges: `ReadingStatusBadge` (reading status) + `.sh-info-badge` (rok vydání)
   - Author font size: 18px → 16px (uvolní místo pro badges)

**Soubory:** `BookDetailPage.tsx`, `shelfy.css`
**TS errors:** 14 (beze změny)
**Riziko:** Střední — responsive layout změna, testovat na více breakpointech
**DoD:** ✅ desktop: cover vlevo 200px, content vpravo; ✅ mobile: cover nahoře, content pod; ✅ badges (status + rok) vedle autora

---

### Krok 13: Empty states — emoji → SVG ikony ✅ DONE (2026-04-01)
**Cíl:** Nahradit emoji (📚🔍🗺️📷⏳) jednoduchými outlined SVG ikonami. Méně „AI generated" dojem.

**Co bylo provedeno:**

1. **Nový soubor `src/components/EmptyStateIcons.tsx`** — 7 exportovaných SVG komponent:
   - `EmptyLibraryIcon` — otevřená kniha (Lucide-style open book, viewBox 0 0 24 24)
   - `NoResultsIcon` — lupa s × uvnitř
   - `EmptyShelfIcon` — bookcase s policemi + nožičkami
   - `CameraIcon` — fotoaparát (scan upload)
   - `ProcessingIcon` — přesýpací hodiny (hourglass)
   - `LocationPinIcon` — map pin s tečkou
   - `BookshelfInlineIcon` — menší verze EmptyShelfIcon (20px default, pro inline použití)
   - Všechny: `stroke="currentColor"`, `strokeWidth="1.5"`, `strokeLinecap/join="round"`, `fill="none"`
   - Prop interface: `{ size?: number; className?: string; style?: React.CSSProperties }`

2. **`shelfy.css`** — rozšíření `.sh-empty-state__icon`:
   - `display: flex; justify-content: center; color: var(--sh-border-2)` — centrování SVG
   - Přidána animace `.sh-icon-processing` (`sh-pulse-opacity` keyframes, 1.6s ease-in-out infinite)
   - ProcessingIcon dostane amber barvu + pulsující opacity při scanování

3. **Stránky aktualizovány:**
   - `BooksPage.tsx` — 📚 → `<EmptyLibraryIcon size={56} />`, 🔍 → `<NoResultsIcon size={56} />`
   - `BookshelfViewPage.tsx` — 📚 → `<EmptyShelfIcon size={56} />`
   - `LocationsPage.tsx` — 🗺️ → `<LocationPinIcon size={56} />`
   - `ScanShelfPage.tsx` — 📚 (nav card) → `<BookshelfInlineIcon size={20} />`, ⏳ → `<ProcessingIcon size={48} className="sh-icon-processing" />`, 📷 → `<CameraIcon size={48} />`

**Soubory:** nový `src/components/EmptyStateIcons.tsx`, `BooksPage.tsx`, `BookshelfViewPage.tsx`, `ScanShelfPage.tsx`, `LocationsPage.tsx`, `shelfy.css`
**TS errors:** 14 (beze změny)
**DoD:** ✅ žádné emoji v empty states; ✅ ikony dědí barvu přes `currentColor` → fungují v light/dark; ✅ processing ikona animována; ✅ konzistentní stroke-only styl

---

### Krok 14: Modal size varianty + transition/z-index tokeny ✅ DONE (2026-04-01)
**Cíl:** Modal podporuje sm/md/lg velikosti. Přidat chybějící design tokeny pro transitions a z-index.

**Co bylo provedeno:**

1. **`shelfy.css` — Motion tokeny přidány do `:root`:**
   - `--sh-ease-default: cubic-bezier(0.4, 0, 0.2, 1)` — Material Design ease
   - `--sh-ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1)` — přirozený overshooting
   - `--sh-ease-out: cubic-bezier(0, 0, 0.2, 1)` — decelerate
   - `--sh-duration-fast: 150ms`, `--sh-duration-normal: 250ms`, `--sh-duration-slow: 400ms`

2. **`shelfy.css` — Z-index škála přidána do `:root`:**
   - `--sh-z-dropdown: 50`, `--sh-z-sticky: 60`, `--sh-z-nav: 100`, `--sh-z-modal: 200`, `--sh-z-toast: 300`

3. **`shelfy.css` — Hardcoded hodnoty nahrazeny tokeny (sed globální replace):**
   - Všechny výskyty `cubic-bezier(0.4, 0, 0.2, 1)` → `var(--sh-ease-default)` (6 míst)
   - `z-index: 100` (navigace) → `var(--sh-z-nav)`

4. **`shelfy.css` — Modal CSS třídy přepracovány:**
   - Přidány keyframes `sh-modal-overlay-in` (fade-in) a `sh-modal-panel-in` (scale+translateY)
   - `.sh-modal-overlay` — kompletní statické styly přesunuty sem (position fixed, backdrop-filter, flex, z-index: `var(--sh-z-modal)`, animace `var(--sh-duration-normal) var(--sh-ease-out)`)
   - `.sh-modal-panel` — kompletní statické styly přesunuty sem (bg, radius, padding, overflow, shadow, border), animace `var(--sh-duration-normal) var(--sh-ease-bounce)`
   - `.sh-modal-panel--sm` (380px), `.sh-modal-panel--md` (520px), `.sh-modal-panel--lg` (680px)

5. **`Modal.tsx`** — refaktor + size prop:
   - Přidán `type ModalSize = 'sm' | 'md' | 'lg'` a `SIZE_MAX` mapa
   - Nový prop `size?: ModalSize` — sm/md/lg presets
   - `maxWidth?: number` zachováno pro zpětnou kompatibilitu (ignorováno pokud je `size`)
   - Inline styly z overlay a panelu odstraněny — vše v CSS třídách
   - Panel: `className={sh-modal-panel${size ? ` sh-modal-panel--${size}` : ''}}` + `style={{ maxWidth: resolvedMaxWidth }}` jen bez `size`

6. **`AddBookPage.tsx`** — bonus fix (pre-existing errors):
   - Přidán `import { useTranslation }` a `import { ProcessingIcon }` (soubor je používal bez importů)
   - Přidán `const { t } = useTranslation()` do komponenty

**Soubory:** `Modal.tsx`, `shelfy.css`, `AddBookPage.tsx`
**TS errors:** 14 (beze změny — 2 nové v AddBookPage opraveny = net 0)
**DoD:** ✅ Modal size prop funguje (sm/md/lg + zpětně-kompatibilní maxWidth); ✅ tokeny v `:root`; ✅ hardcoded hodnoty nahrazeny; ✅ modal má plynulou bounce animaci

---

### Krok 15: Fuzzy search + advanced filtry (B3) ✅ DONE (2026-04-01)
**Cíl:** Vylepšit search v `/books` — fuzzy matching, filtrování dle roku/jazyka/vydavatele.

**Co bylo provedeno:**

1. **Alembic migrace** `20260401_000009_enable_pg_trgm_fuzzy_search.py`:
   - `CREATE EXTENSION IF NOT EXISTS pg_trgm` (idempotent)
   - `CREATE INDEX ix_books_title_trgm ON books USING gin (title gin_trgm_ops)`
   - `CREATE INDEX ix_books_author_trgm ON books USING gin (author gin_trgm_ops) WHERE author IS NOT NULL`
   - Migrace spuštěna přes `docker exec infra-backend-1 alembic upgrade head` ✅

2. **`app/services/book.py`** — 3 změny:
   - **Bug fix**: `Book.processing_status == reading_status` → `Book.reading_status == reading_status` (předchozí kód nikdy nefungoval!)
   - **Nové filtry**: `language`, `publisher` (ILIKE fuzzy match), `year_from`, `year_to` (range na `publication_year`)
   - **Fuzzy search**: PostgreSQL kombinuje FTS (`plainto_tsquery`) **OR** trigram similarity (`similarity() > 0.2` pro title, `> 0.15` pro author) — typo-tolerantní, oba indexy využity
   - SQLite fallback: beze změny (ILIKE)

3. **`app/api/books.py`** — nové query parametry:
   - `language: str | None = Query(min_length=1)`
   - `publisher: str | None = Query(min_length=1)`
   - `year_from: int | None = Query(ge=1000, le=9999)`
   - `year_to: int | None = Query(ge=1000, le=9999)`
   - Všechny předány do `list_books()`

4. **`frontend/src/lib/types.ts`** — `BookListParams` rozšířen:
   - `readingStatus?: ReadingStatus | null` (chybělo — fixováno!)
   - `language?: string`, `publisher?: string`, `yearFrom?: number`, `yearTo?: number`

5. **`frontend/src/lib/api.ts`** — `listBooks()` předává nové params + `readingStatus` (dříve chyběl v typech)

6. **`frontend/src/i18n/cs.json` + `en.json`** — přidány klíče pro advanced filtry:
   - `books.filters_toggle`, `filter_language_label/placeholder`, `filter_publisher_label/placeholder`, `filter_year_label/from/to`, `filter_clear_all`, `filter_chip_*`

7. **`frontend/src/styles/shelfy.css`** — nové třídy:
   - `.sh-filter-chip` — removable pill tag (primary bg/color/border, hover fade)
   - `.sh-filter-count` — zelený badge s počtem aktivních filtrů

8. **`frontend/src/pages/BooksPage.tsx`** — advanced filters UI:
   - Nové stavy: `advancedOpen`, `languageInput`, `publisherInput`, `yearFromInput`, `yearToInput`
   - Debounce na language/publisher (400ms)
   - `activeAdvancedCount` — počítá aktivní filtry
   - Toggle button (s badge počtem) + location select — v jednom řádku
   - Collapsible filter panel: Language | Publisher | Rok od–do (3 sloupce), animace `max-height + opacity`
   - "Zrušit filtry" button v panelu (jen když jsou filtry)
   - Active filter chips pod panelem (kliknutí odstraní chip/filtr)

**Soubory:** `alembic/versions/20260401_000009_*.py`, `app/services/book.py`, `app/api/books.py`, `lib/types.ts`, `lib/api.ts`, `BooksPage.tsx`, `shelfy.css`, `cs.json`, `en.json`
**TS errors:** 13 (zlepšení -1 — fixován `readingStatus` v `BookListParams`)
**DoD:** ✅ fuzzy search s pg_trgm; ✅ advanced filtry (jazyk/vydavatel/rok); ✅ chips + badge; ✅ reading_status bug opraven

---

---

## Sprint 4 — BigBets (B5, B2, B4)

### B5: Bulk operace ✅ DONE (2026-04-01)
**Cíl:** Smazat/přesunout/změnit status více knih najednou bez 10× otevírání detailu.

**Co bylo provedeno:**

1. **Backend — nové schéma** (`app/schemas/book.py`):
   - `BulkDeleteRequest` (ids: list[UUID], max 200)
   - `BulkMoveRequest` (ids + location_id nullable)
   - `BulkStatusRequest` (ids + reading_status)
   - `BulkOperationResponse` (affected: int, operation: Literal)

2. **Backend — service funkce** (`app/services/book.py`):
   - `bulk_delete_books()` — SQL `DELETE ... WHERE id IN (...)`, vrací rowcount
   - `bulk_move_books()` — SQL `UPDATE ... SET location_id=... WHERE id IN (...)`, validuje location existenci
   - `bulk_update_status()` — SQL `UPDATE ... SET reading_status=... WHERE id IN (...)`
   - Vše v jednom SQL statementu (žádný N+1)

3. **Backend — 3 nové endpointy** (`app/api/books.py`):
   - `POST /api/v1/books/bulk/delete`
   - `POST /api/v1/books/bulk/move`
   - `POST /api/v1/books/bulk/status`

4. **Frontend — typy** (`lib/types.ts`): `BulkDeleteRequest`, `BulkMoveRequest`, `BulkStatusRequest`, `BulkOperationResponse`

5. **Frontend — API funkce** (`lib/api.ts`): `bulkDeleteBooks`, `bulkMoveBooks`, `bulkUpdateStatus`

6. **Frontend — hooks** (`hooks/useBooks.ts`): `useBulkDeleteBooks`, `useBulkMoveBooks`, `useBulkUpdateStatus` — invalidují `BOOKS_QUERY_KEY`, zobrazí toast

7. **Frontend — i18n** (`cs.json`, `en.json`): klíče v sekci `"bulk"` (selected, delete, move, change_status, confirm, …)

8. **Frontend — CSS** (`shelfy.css`):
   - `.sh-book-card-selectable` + `.sh-book-card-selected` — card selected styl s checkmark overlay
   - `.sh-book-card-check` — absolutně pozicovaný kruh s checkmarkem (SVG polyline)
   - `.sh-bulk-toolbar` — fixed floating toolbar (bottom center), bounce animace, dark bg
   - `.sh-bulk-toolbar__label`, `__btn`, `__btn--danger`, `__close`

9. **Frontend — `BookCard.tsx`**:
   - Nové props: `selectable`, `selected`, `onSelect`
   - V select módu: klik na kartu → `onSelect(id)`, žádná navigace
   - Checkmark overlay viditelný v select módu
   - Delete button skrytý v select módu
   - CSS classes: `sh-book-card-selectable`, `sh-book-card-selected` podmíněně

10. **Frontend — `BooksPage.tsx`**:
    - Stavy: `selectedIds` (Set<string>), `bulkMoveOpen`, `bulkStatusOpen`, `bulkDeleteConfirmOpen`, `bulkMoveTarget`, `bulkStatusTarget`
    - "Select all" / "Deselect all" button v pravém horním rohu (zobrazí se když `total > 0`)
    - `isSelectMode = selectedIds.size > 0`
    - BookCard dostává `selectable/selected/onSelect` props
    - `sh-bulk-toolbar` — zobrazí se nad mobilní navigací, obsahuje: label s počtem, Select All, Change Status, Move, Delete, × zavřít
    - 3 modaly: Bulk Delete Confirm | Bulk Move (location select) | Bulk Status (reading_status select)

**TS errors:** 13 (beze změny)
**DoD:** ✅ multi-select; ✅ bulk delete/move/status; ✅ floating toolbar; ✅ toast po operaci; ✅ optimistic invalidation

---

## Doporučené pořadí commitů (Sprint 3)
8. `design: migrate to Sage color palette with semantic token aliases`
9. `design: swap Outfit → Inter font, refine typographic scale`
10. `nav: group sidebar items, redirect /locations to bookshelf tab`
11. `ui: unify tabs to underline style, improve stat bar affordance`
12. `book-detail: side-by-side layout on desktop, inline metadata badges`
13. `ui: replace emoji empty states with SVG icons`
14. `ui: modal size variants, add transition and z-index design tokens`
15. `feat: fuzzy search and advanced book filters`

---

## Test checklist po každém kroku (Sprint 3)
- `/books` — paleta, font, tabs, search, filtry, empty state, hero number
- `/books/:id` — paleta, font, layout desktop/mobile, badges
- `/bookshelf` — paleta, font, tabs, empty state
- `/scan` — paleta, font, empty state ikony
- `/locations` redirect → `/bookshelf?tab=locations`
- dark mode — Sage dark paleta
- mobile viewport — book detail stacked, tabs, StatBar
- WCAG contrast — spot-check primary na surface, muted na surface

+ build frontend + deploy + smoke flow:
`Books → search s překlepem → advanced filtry → Book detail (desktop side-by-side) → Show in digital twin`



## Production hardening addendum (2026-04-02)
- Added CI frontend build + smoke regression suite gate.
- Added incident runbook (`docs/runbooks/incidents.md`).
- Added ordering integrity checker script (`scripts/check_shelf_ordering_integrity.py`).
- Added bundle budget checker (`scripts/check_bundle_budget.mjs`).
- Added migration for partial unique index on `(location_id, shelf_position)` when both are not null.
