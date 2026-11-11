# ADR 013 — Dva tarify: Free + Podporovatel

- **Stav:** přijato
- **Datum:** 2026-11-11
- **Souvisí:** ADR 006 (Gemini Vision), `backend/app/core/plan_limits.py`

## Kontext

Shelfy nabízelo čtyři placené úrovně (Free / Home 59 Kč / Pro 129 Kč /
Library 299 Kč). V listopadu 2026 nemělo žádného platícího zákazníka a
jen jednoho aktivního uživatele mimo autora. Free tarif přitom narážel
na limity, které Shelfy nic nestojí:

- **200 knih na knihovnu**: knihomol, pro kterého je aplikace určená,
  na limit narazí dřív, než si ji oblíbí.
- **20 obohacení metadat měsíčně**: Open Library a Knihovny.cz jsou zdarma.
- **1 člen na knihovnu**: sdílení s rodinou je hlavní domácí scénář.

Jediná funkce se skutečnými náklady na použití je sken poličky přes
Gemini Vision. Podle odhadu z ceníku Gemini 3.8 Flash stojí sken zhruba
0,25 Kč, od 1. 1. 2027 kolem 0,5 Kč. Za skutečné skeny to změřené není.

## Rozhodnutí

1. **Nabízí se jen dva tarify:**
   - **Free:** neomezeně knih, neomezené obohacení, 1 knihovna,
     3 členové, **20 skenů měsíčně**.
   - **Podporovatel** (interní klíč `home`): 59 Kč měsíčně nebo 590 Kč
     ročně, 60 skenů, 5 knihoven, 10 členů, neomezeně knih, 14denní
     trial. Používá **stávající Stripe ceny `home`**, nové ceny ani
     produkty zakládat není potřeba.
2. **`pro` a `library` jsou původní tarify.** Už se neprodávají
   (`PURCHASABLE_PLANS`, `CheckoutRequest.plan = "home"`), webhooky ale
   jejich ceny dál mapují, takže stávající předplatitelé o nic nepřijdou.
   Jejich limity nesmí být nižší než u Podporovatele (hlídá test).
3. Interní klíče tarifů zůstávají beze změny: `home` se v UI jen
   přejmenoval. Žádná migrace DB ani Stripe.

## Důsledky

- Výdaje za Gemini na free uživatele jsou podle stejného odhadu
  nejvýš ~5–10 Kč měsíčně při plném využití 20 skenů, typicky výrazně méně.
- Platit se vyplatí hlavně těm, kdo hodně skenují, a těm, kdo chtějí
  projekt podpořit. Příjem tak nestojí na umělých limitech.
- Uživatel s původním tarifem uvidí v ceníku místo tlačítka k nákupu
  poznámku. Nemůže si tak omylem založit druhé předplatné a změny řeší
  přes Stripe portál.
- Limity `books_per_library` a `*_per_month` podporují `-1`
  (neomezeno), `libraries` a `members_per_library` musí zůstat konečné.

## Zvážené alternativy

- **Ponechat 4 tarify a jen uvolnit Free:** zbytečná složitost ceníku pro
  produkt bez platících zákazníků.
- **Vlastní API klíč uživatele (BYOK):** zamítnuto v ADR 006 kvůli
  riziku spojenému s ukládáním cizích klíčů.

## Dodatek 2026-11-11 — prodej zatím vypnutý

Prodávat předplatné spotřebitelům je v ČR podnikání. Na webu proto musí
být identifikace provozovatele (jméno, IČO, adresa) a provozovatel musí mít
živnostenské oprávnění, a to bez ohledu na výši příjmu. Hranice 2 mil. Kč se
týká jen DPH. Autor má živnost teď přerušenou, a proto:

- **`BILLING_CHECKOUT_ENABLED=false`** (backend, výchozí hodnota) +
  `CHECKOUT_ENABLED = false` (`frontend/src/lib/billing-flags.ts`). Checkout
  vrací 503, v UI není nabídka placeného tarifu ani tlačítka k nákupu.
- Limity zůstávají podle tohoto ADR. Free má 20 skenů měsíčně, víc dá autor
  ručně (`app.cli.set_plan --plan home`, např. beta testerům).
- Stávající předplatitelé (pro/library) fungují dál: webhooky, portál, limity.
- Zapnutí = obnovit živnost, doplnit údaje provozovatele do Obchodních
  podmínek a Zásad soukromí (#302) a přepnout oba přepínače.
