import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../lib/routes'

const SECTION: CSSProperties = { marginBottom: 32 }
const H2: CSSProperties = { fontSize: 18, fontWeight: 700, margin: '0 0 8px' }
const P: CSSProperties = { margin: '0 0 10px', lineHeight: 1.7, color: 'var(--sh-text-secondary)' }
const UL: CSSProperties = { paddingLeft: 20, color: 'var(--sh-text-secondary)', lineHeight: 1.7, margin: '0 0 10px' }
const TABLE: CSSProperties = { width: '100%', borderCollapse: 'collapse', margin: '10px 0 16px', fontSize: 14 }
const TH: CSSProperties = { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--sh-border)', fontWeight: 600, fontSize: 13 }
const TD: CSSProperties = { padding: '8px 12px', borderBottom: '1px solid var(--sh-border)', verticalAlign: 'top', color: 'var(--sh-text-secondary)' }

const EFFECTIVE_DATE = '8. dubna 2026'
const VERSION = '2.0'
const CONTACT_EMAIL = 'info@shelfy.cz'
const PRIVACY_EMAIL = 'privacy@shelfy.cz'

export function TermsPage() {
  const navigate = useNavigate()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sh-bg)' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 24px',
          borderBottom: '1px solid var(--sh-border)',
          background: 'var(--sh-surface)',
        }}
      >
        <button
          type='button'
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 20 }}
          onClick={() => navigate('/')}
        >
          📚 Shelfy
        </button>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 80px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>Obchodní podmínky</h1>
        <p style={{ ...P, fontSize: 13, marginBottom: 8 }}>
          Verze {VERSION} · Účinnost od {EFFECTIVE_DATE}
        </p>

        {/* ── Human-friendly summary ── */}
        <div style={{
          background: 'var(--sh-surface-elevated)',
          border: '1px solid var(--sh-border)',
          borderRadius: 'var(--sh-radius-md)',
          padding: '16px 20px',
          marginBottom: 36,
        }}>
          <p style={{ ...P, fontWeight: 600, color: 'var(--sh-text-main)', marginBottom: 8 }}>Shrnutí pro lidi</p>
          <ul style={{ ...UL, margin: 0 }}>
            <li>Shelfy je aplikace na správu osobní knihovny. Základní verze je zdarma.</li>
            <li>Placené plány se platí měsíčně přes Stripe. Zrušit můžete kdykoliv v Nastavení.</li>
            <li>Vaše knihy a data patří vám. Můžete si je kdykoliv exportovat nebo smazat účet.</li>
            <li>Nesnažíme se nic skrývat — jestli máte otázku, napište na {CONTACT_EMAIL}.</li>
          </ul>
        </div>

        {/* ── 1. Úvodní ustanovení ── */}
        <div style={SECTION}>
          <h2 style={H2}>1. Úvodní ustanovení</h2>
          <table style={TABLE}>
            <tbody>
              <tr><td style={{ ...TD, fontWeight: 600, width: 160 }}>Poskytovatel</td><td style={TD}>Patrik Šušlík, IČO: 24561401</td></tr>
              {/* TODO: doplnit sídlo */}
              <tr><td style={{ ...TD, fontWeight: 600 }}>Sídlo</td><td style={TD}>—</td></tr>
              <tr><td style={{ ...TD, fontWeight: 600 }}>E-mail</td><td style={TD}><a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--sh-primary)' }}>{CONTACT_EMAIL}</a></td></tr>
              <tr><td style={{ ...TD, fontWeight: 600 }}>Web</td><td style={TD}>https://shelfy.cz</td></tr>
            </tbody>
          </table>
          <p style={P}>
            Tyto obchodní podmínky (dále jen „Podmínky") upravují práva a povinnosti
            mezi Poskytovatelem a uživatelem (dále jen „Uživatel") při používání webové
            aplikace Shelfy dostupné na adrese https://shelfy.cz (dále jen „Služba").
          </p>
          <p style={P}>
            Vytvořením účtu Uživatel potvrzuje, že se s těmito Podmínkami seznámil
            a souhlasí s nimi. Podmínky se řídí právním řádem České republiky,
            zejména zákonem č. 89/2012 Sb. (občanský zákoník) a zákonem č. 634/1992 Sb.
            (o ochraně spotřebitele).
          </p>
        </div>

        {/* ── 2. Popis služby ── */}
        <div style={SECTION}>
          <h2 style={H2}>2. Popis služby</h2>
          <p style={P}>
            Shelfy je webová aplikace pro správu osobní knihovny. Umožňuje evidenci knih,
            AI rozpoznání knih ze snímků polic, správu výpůjček, sdílení knihovny
            a automatické obohacení metadat z online databází.
          </p>
          <p style={P}>
            Služba je dostupná ve variantě zdarma (s funkčními a kapacitními omezeními)
            a v placených plánech. Aktuální přehled plánů, funkcí a cen je uveden na
            stránce Plány &amp; Ceny v aplikaci.
          </p>
        </div>

        {/* ── 3. Registrace a účet ── */}
        <div style={SECTION}>
          <h2 style={H2}>3. Registrace a uživatelský účet</h2>
          <ul style={UL}>
            <li>Pro používání Služby je nutná registrace e-mailem a heslem.</li>
            <li>Uživatel musí být starší 16 let.</li>
            <li>Každá osoba smí mít jeden účet. Sdílení přihlašovacích údajů není povoleno.</li>
            <li>Uživatel odpovídá za bezpečnost svých přihlašovacích údajů.</li>
            <li>Poskytovatel si vyhrazuje právo zrušit účet, který porušuje tyto Podmínky.</li>
          </ul>
        </div>

        {/* ── 4. Ceny a platby ── */}
        <div style={SECTION}>
          <h2 style={H2}>4. Ceny, platby a fakturace</h2>
          <p style={P}>
            Placené plány jsou účtovány měsíčně předem. Platby zpracovává Stripe.
            Poskytovatel nikdy neukládá čísla platebních karet.
          </p>
          <p style={P}>
            Aktuální ceny jsou vždy uvedeny na stránce Plány &amp; Ceny a jsou
            konečné (Poskytovatel není plátcem DPH, případně ceny zahrnují DPH).
          </p>
          <p style={P}>
            Za každou platbu Uživatel obdrží daňový doklad (fakturu) na e-mail spojený s účtem.
          </p>
        </div>

        {/* ── 5. Zrušení a refundace ── */}
        <div style={SECTION}>
          <h2 style={H2}>5. Zrušení předplatného a vrácení peněz</h2>
          <p style={P}>
            Předplatné můžete kdykoliv zrušit v <em>Nastavení → Spravovat předplatné</em>.
            Po zrušení zůstává plán aktivní do konce aktuálního zaplaceného období.
            Po jeho uplynutí se účet automaticky převede na bezplatnou variantu — data
            zůstanou zachována.
          </p>
          <p style={P}>
            <strong>Vrácení peněz:</strong> Požádejte e-mailem na{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--sh-primary)' }}>{CONTACT_EMAIL}</a>{' '}
            do 14 dnů od platby. Žádost posoudíme individuálně.
          </p>
        </div>

        {/* ── 6. Odstoupení od smlouvy (spotřebitel) ── */}
        <div style={SECTION}>
          <h2 style={H2}>6. Právo spotřebitele na odstoupení od smlouvy</h2>
          <p style={P}>
            Pokud jste spotřebitel ve smyslu § 419 občanského zákoníku, máte právo
            odstoupit od smlouvy bez udání důvodu do 14 dnů od jejího uzavření
            (§ 1829 občanského zákoníku).
          </p>
          <p style={P}>
            Pokud při objednávce výslovně požádáte o okamžité zpřístupnění placené
            Služby a potvrdíte, že berete na vědomí, že tím ztrácíte právo na
            odstoupení, právo na odstoupení zaniká okamžikem zpřístupnění Služby
            (§ 1837 písm. l občanského zákoníku).
          </p>
          <p style={P}>
            Pro odstoupení od smlouvy zašlete jednoznačné prohlášení na{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--sh-primary)' }}>{CONTACT_EMAIL}</a>.
          </p>
        </div>

        {/* ── 7. Přijatelné použití ── */}
        <div style={SECTION}>
          <h2 style={H2}>7. Pravidla používání</h2>
          <p style={P}>Uživatel se zavazuje, že nebude:</p>
          <ul style={UL}>
            <li>Pokoušet se o zpětnou analýzu, automatické stahování dat (scraping) nebo přetěžování Služby.</li>
            <li>Nahrávat obsah porušující práva duševního vlastnictví třetích osob.</li>
            <li>Používat Službu k jakémukoliv nezákonnému účelu.</li>
            <li>Obcházet technická omezení bezplatného plánu.</li>
          </ul>
          <p style={P}>
            Poskytovatel si vyhrazuje právo pozastavit nebo zrušit účet, který tato
            pravidla porušuje — po předchozím upozornění, kromě závažných porušení.
          </p>
        </div>

        {/* ── 8. Data a soukromí ── */}
        <div style={SECTION}>
          <h2 style={H2}>8. Osobní údaje a soukromí</h2>
          <p style={P}>
            Zpracování osobních údajů se řídí samostatnými{' '}
            <button
              type='button'
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sh-primary)', padding: 0, fontSize: 'inherit', textDecoration: 'underline' }}
              onClick={() => navigate(ROUTES.privacy)}
            >
              Zásadami ochrany osobních údajů
            </button>.
          </p>
          <ul style={UL}>
            <li>Veškerý obsah, který Uživatel vytvoří (knihy, výpůjčky, lokace), zůstává jeho vlastnictvím.</li>
            <li>Poskytovatel neprodává a nesdílí data Uživatele za účelem reklamy.</li>
            <li>Uživatel může kdykoli exportovat svá data (JSON) nebo smazat celý účet v Nastavení.</li>
          </ul>
        </div>

        {/* ── 9. Dostupnost a zálohy ── */}
        <div style={SECTION}>
          <h2 style={H2}>9. Dostupnost služby</h2>
          <p style={P}>
            Poskytovatel usiluje o nepřetržitou dostupnost Služby, ale negarantuje
            konkrétní míru dostupnosti (uptime). Služba může být dočasně nedostupná
            z důvodu údržby, aktualizací nebo okolností mimo kontrolu Poskytovatele (vyšší moc).
          </p>
          <p style={P}>
            Poskytovatel provádí pravidelné automatizované zálohy dat s 30denní retencí.
            V případě potřeby obnovy dat kontaktujte podporu.
          </p>
        </div>

        {/* ── 10. Odpovědnost ── */}
        <div style={SECTION}>
          <h2 style={H2}>10. Omezení odpovědnosti</h2>
          <p style={P}>
            Služba je poskytována „tak jak je" (as-is). V maximálním rozsahu povoleném
            právními předpisy odpovídá Poskytovatel za škodu vzniklou Uživateli
            maximálně do výše částky, kterou Uživatel zaplatil Poskytovateli
            za posledních 12 měsíců, minimálně však 50 EUR.
          </p>
          <p style={P}>
            Toto omezení se nevztahuje na škodu způsobenou úmyslně nebo z hrubé
            nedbalosti a neomezuje práva spotřebitele vyplývající z kogentních
            ustanovení českého práva.
          </p>
        </div>

        {/* ── 11. Reklamace ── */}
        <div style={SECTION}>
          <h2 style={H2}>11. Reklamace a řešení sporů</h2>
          <p style={P}>
            Reklamace a stížnosti zasílejte na{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--sh-primary)' }}>{CONTACT_EMAIL}</a>.
            Reklamaci vyřídíme nejpozději do 30 dnů od jejího obdržení.
          </p>
          <p style={P}>
            Mimosoudní řešení spotřebitelských sporů je v kompetenci České obchodní
            inspekce (ČOI):{' '}
            <a href='https://www.coi.cz/informace-o-adr/' style={{ color: 'var(--sh-primary)' }}>
              www.coi.cz/informace-o-adr
            </a>
          </p>
          <p style={P}>
            Pro online řešení sporů můžete rovněž využít platformu ODR Evropské komise:{' '}
            <a href='https://ec.europa.eu/consumers/odr' style={{ color: 'var(--sh-primary)' }}>
              ec.europa.eu/consumers/odr
            </a>
          </p>
        </div>

        {/* ── 12. Rozhodné právo ── */}
        <div style={SECTION}>
          <h2 style={H2}>12. Rozhodné právo a příslušnost</h2>
          <p style={P}>
            Tyto Podmínky se řídí právním řádem České republiky. Případné spory
            budou rozhodovány příslušnými soudy České republiky.
          </p>
          <p style={P}>
            Tím nejsou dotčena práva spotřebitele na ochranu dle právních předpisů
            státu jeho bydliště, pokud poskytují vyšší míru ochrany.
          </p>
        </div>

        {/* ── 13. Změny podmínek ── */}
        <div style={SECTION}>
          <h2 style={H2}>13. Změny těchto podmínek</h2>
          <p style={P}>
            O podstatných změnách Podmínek informujeme e-mailem minimálně 14 dní předem.
            Pokračování v užívání Služby po datu účinnosti změn znamená souhlas s novým
            zněním. Pokud se změnami nesouhlasíte, můžete účet kdykoli zrušit.
          </p>
        </div>

        <p style={{ ...P, fontSize: 13, fontStyle: 'italic', marginTop: 24 }}>
          Otázky? Napište nám na{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--sh-primary)' }}>{CONTACT_EMAIL}</a>.
        </p>

        <button
          type='button'
          className='sh-btn-secondary'
          style={{ marginTop: 8 }}
          onClick={() => navigate(-1)}
        >
          ← Zpět
        </button>
      </main>
    </div>
  )
}
