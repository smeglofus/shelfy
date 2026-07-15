# ADR 012: Knihovny.cz jako první metadatový zdroj pro české tituly

- **Status:** Accepted
- **Date:** 2026-07-15
- **Navazuje na:** ADR 009 (Open Library jako výchozí zdroj), issue #311

## Context

Open Library (ADR 009) funguje dobře pro anglické tituly, ale pokrytí
českých knih je slabé: chybějí ISBN u vydání, anotace prakticky vždy a
často i celé záznamy. Uživatelé s převážně českou knihovnou tak z funkce
„obohatit" dostávají prázdná pole.

Zvažované české zdroje (z issue #311):

| Zdroj | Přístup | Poznámka |
|---|---|---|
| **Knihovny.cz** (MZK, centrální portál knihoven ČR) | veřejné VuFind JSON API | výborné pokrytí, **české anotace**, čistý JSON, bez registrace |
| NK ČR Aleph X-Server / SRU | XML/MARC | X-Server má **IP allowlist** (ověřeno 403), MARCXML parsování je pracné |
| ObalkyKnih.cz | API pro knihovny | obálky + anotace; **komerční užití vyžaduje dohodu** — Patrik ověří |
| Wikidata | SPARQL, CC0 | řídké pokrytí knih |
| Databázeknih.cz | žádné API | scraping proti podmínkám |
| ISBNdb | $15–300/měs. | až kdyby zdarma zdroje nestačily |

Knihovny.cz agreguje katalogy českých knihoven včetně fondů NK ČR,
takže z praktického hlediska pokrývá totéž co přímý přístup do NK ČR,
ale přes moderní, veřejně dostupné JSON API.

## Decision

1. **Knihovny.cz se přidává jako druhý provider** vedle Open Library
   (backend `app/services/metadata/knihovny.py`, worker
   `worker/knihovny_client.py` — zrcadlení dle zavedeného vzoru).
2. **Pořadí providerů řídí heuristika `looks_czech`**: česká diakritika
   v názvu/autorovi nebo ISBN skupina 978-80/80 → Knihovny.cz první,
   Open Library fallback; jinak Open Library první, Knihovny.cz fallback.
3. **Gap-fill:** vítězný záznam se doplní o `cover_image_url` a
   `description` z dalšího provideru v pořadí (Knihovny.cz nevrací volně
   použitelné obálky; Open Library nemívá české anotace). Best-effort,
   výsledek se cachuje včetně doplněných polí.
4. Google Books zůstává beze změny za `ENABLE_GOOGLE_BOOKS` (ADR 009) a
   gap-fill se na jeho výsledky nevztahuje.
5. Kill-switch `ENABLE_KNIHOVNY_CZ` (default zapnuto) v backendu i workeru.

## Consequences

- České tituly dostanou z obohacení ISBN, nakladatele, rok a českou
  anotaci; obálka se dotáhne z Open Library, pokud ji má.
- Pro české knihy se typicky volají oba providery (gap-fill obálky) —
  akceptovatelné: enrichment je rate-limitovaný (1,5 s mezi knihami)
  a výsledky se cachují 7 dní (backend) / 24 h (worker).
- Obálky českých knih zůstávají slabé místo — ObalkyKnih.cz by je
  vyřešilo, ale vyžaduje licenční dohodu (obchodní krok mimo kód).
- Závislost na dostupnosti knihovny.cz je měkká: výpadek = fallback na
  Open Library, kill-switch pro úplné vypnutí.
- Stejná logika výběru zdroje se nabízí i pro ověřování skenu
  (worker/catalog_match.py) — české hřbety by proti knihovny.cz
  matchovaly lépe než proti Open Library; ponecháno jako follow-up.
