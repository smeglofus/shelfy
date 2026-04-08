import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'

const SECTION: CSSProperties = { marginBottom: 32 }
const H2: CSSProperties = { fontSize: 18, fontWeight: 700, margin: '0 0 8px' }
const H3: CSSProperties = { fontSize: 15, fontWeight: 600, margin: '16px 0 6px' }
const P: CSSProperties = { margin: '0 0 10px', lineHeight: 1.7, color: 'var(--sh-text-secondary)' }
const UL: CSSProperties = { paddingLeft: 20, color: 'var(--sh-text-secondary)', lineHeight: 1.7, margin: '0 0 10px' }
const TABLE: CSSProperties = { width: '100%', borderCollapse: 'collapse', margin: '10px 0 16px', fontSize: 14 }
const TH: CSSProperties = { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--sh-border)', fontWeight: 600, fontSize: 13 }
const TD: CSSProperties = { padding: '8px 12px', borderBottom: '1px solid var(--sh-border)', verticalAlign: 'top', color: 'var(--sh-text-secondary)' }

const EFFECTIVE_DATE = '8. dubna 2026'
const VERSION = '2.0'
const CONTACT_EMAIL = 'privacy@shelfy.cz'

export function PrivacyPage() {
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
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>Zásady ochrany osobních údajů</h1>
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
            <li>Ukládáme jen to, co potřebujeme k provozu služby (e-mail, heslo, vaše knihy).</li>
            <li>Neprodáváme a nesdílíme vaše data s třetími stranami za účelem reklamy.</li>
            <li>Svá data si můžete kdykoliv stáhnout (JSON export) nebo smazat celý účet — obojí v Nastavení.</li>
            <li>Nepoužíváme sledovací cookies. Analytika (PostHog) běží bez cookies.</li>
            <li>Data jsou uložena na serveru v Česku, za Cloudflare ochranou.</li>
          </ul>
        </div>

        {/* ── 1. Správce ── */}
        <div style={SECTION}>
          <h2 style={H2}>1. Správce osobních údajů</h2>
          <table style={TABLE}>
            <tbody>
              <tr><td style={{ ...TD, fontWeight: 600, width: 160 }}>Správce</td><td style={TD}>Patrik Šušlík</td></tr>
              <tr><td style={{ ...TD, fontWeight: 600 }}>IČO</td><td style={TD}>24561401</td></tr>
              {/* TODO: doplnit sídlo po ověření s právníkem */}
              <tr><td style={{ ...TD, fontWeight: 600 }}>Sídlo</td><td style={TD}>—</td></tr>
              <tr><td style={{ ...TD, fontWeight: 600 }}>E-mail</td><td style={TD}><a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--sh-primary)' }}>{CONTACT_EMAIL}</a></td></tr>
              <tr><td style={{ ...TD, fontWeight: 600 }}>Web</td><td style={TD}>https://shelfy.cz</td></tr>
            </tbody>
          </table>
          <p style={P}>
            Správce neurčil pověřence pro ochranu osobních údajů (DPO), protože zpracování
            nevyžaduje jeho jmenování podle čl. 37 GDPR. Pro veškeré dotazy ohledně ochrany
            osobních údajů kontaktujte e-mail výše.
          </p>
        </div>

        {/* ── 2. Jaké údaje zpracováváme ── */}
        <div style={SECTION}>
          <h2 style={H2}>2. Jaké osobní údaje zpracováváme</h2>
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH}>Kategorie</th>
                <th style={TH}>Co konkrétně</th>
                <th style={TH}>Účel</th>
                <th style={TH}>Právní základ</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={TD}>Účetní údaje</td>
                <td style={TD}>E-mail, bcrypt hash hesla</td>
                <td style={TD}>Registrace a přihlášení</td>
                <td style={TD}>Plnění smlouvy (čl. 6/1b)</td>
              </tr>
              <tr>
                <td style={TD}>Data knihovny</td>
                <td style={TD}>Knihy, výpůjčky, lokace, výsledky skenování</td>
                <td style={TD}>Provoz služby</td>
                <td style={TD}>Plnění smlouvy (čl. 6/1b)</td>
              </tr>
              <tr>
                <td style={TD}>Fakturační údaje</td>
                <td style={TD}>Plán předplatného, Stripe customer ID</td>
                <td style={TD}>Správa předplatného a fakturace</td>
                <td style={TD}>Plnění smlouvy (čl. 6/1b)</td>
              </tr>
              <tr>
                <td style={TD}>Měřiče využití</td>
                <td style={TD}>Počet skenování a obohacení za měsíc</td>
                <td style={TD}>Kontrola kvót</td>
                <td style={TD}>Plnění smlouvy (čl. 6/1b)</td>
              </tr>
              <tr>
                <td style={TD}>Analytická data</td>
                <td style={TD}>Anonymizované události používání (PostHog)</td>
                <td style={TD}>Vylepšování služby</td>
                <td style={TD}>Oprávněný zájem (čl. 6/1f)</td>
              </tr>
              <tr>
                <td style={TD}>Technické logy</td>
                <td style={TD}>IP adresa, user-agent, chybové záznamy (Sentry)</td>
                <td style={TD}>Bezpečnost, diagnostika</td>
                <td style={TD}>Oprávněný zájem (čl. 6/1f)</td>
              </tr>
            </tbody>
          </table>
          <p style={P}>
            <strong>Nikdy neukládáme</strong> čísla platebních karet — platby zpracovává výhradně Stripe.
            Fotografie polic odesílané k AI rozpoznání jsou zpracovány a ihned po zpracování zahozeny.
          </p>
        </div>

        {/* ── 3. Zpracovatelé ── */}
        <div style={SECTION}>
          <h2 style={H2}>3. Příjemci a zpracovatelé</h2>
          <p style={P}>Vaše data sdílíme pouze se zpracovateli nezbytnými pro provoz služby:</p>
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH}>Zpracovatel</th>
                <th style={TH}>Účel</th>
                <th style={TH}>Sídlo / data residency</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={TD}>Stripe, Inc.</td><td style={TD}>Platby a fakturace</td><td style={TD}>USA (EU data residency, SCC)</td></tr>
              <tr><td style={TD}>Google LLC (Gemini API)</td><td style={TD}>AI rozpoznání knih ze snímků polic</td><td style={TD}>USA (SCC); snímky nejsou uchovávány</td></tr>
              <tr><td style={TD}>Functional Software (Sentry)</td><td style={TD}>Monitoring chyb</td><td style={TD}>USA (SCC)</td></tr>
              <tr><td style={TD}>PostHog, Inc.</td><td style={TD}>Produktová analytika</td><td style={TD}>EU (eu.posthog.com)</td></tr>
              <tr><td style={TD}>Resend, Inc.</td><td style={TD}>Transakční e-maily</td><td style={TD}>USA (SCC)</td></tr>
              <tr><td style={TD}>Cloudflare, Inc.</td><td style={TD}>CDN, DDoS ochrana, TLS terminace</td><td style={TD}>Globální (SCC)</td></tr>
            </tbody>
          </table>
          <p style={P}>
            U zpracovatelů mimo EU/EHP se opíráme o standardní smluvní doložky (SCC) podle
            rozhodnutí Evropské komise. Data knihovny a databáze jsou uložena na vlastním serveru v České republice.
          </p>
        </div>

        {/* ── 4. Přenos mimo EU ── */}
        <div style={SECTION}>
          <h2 style={H2}>4. Přenos údajů mimo EU</h2>
          <p style={P}>
            Některé služby třetích stran (Stripe, Google, Sentry, Resend, Cloudflare) mohou
            zpracovávat data v USA. Ve všech případech jsou využity standardní smluvní doložky (SCC)
            a/nebo rozhodnutí o přiměřenosti jako záruky dle kapitoly V GDPR.
          </p>
        </div>

        {/* ── 5. Doba uchovávání ── */}
        <div style={SECTION}>
          <h2 style={H2}>5. Doba uchovávání údajů</h2>
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH}>Údaje</th>
                <th style={TH}>Doba uchovávání</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={TD}>Účet a data knihovny</td><td style={TD}>Po dobu existence účtu</td></tr>
              <tr><td style={TD}>Po smazání účtu</td><td style={TD}>Nevratně odstraněno do 30 dnů (zálohy rotovány po 30 dnech)</td></tr>
              <tr><td style={TD}>Technické logy</td><td style={TD}>30 dnů</td></tr>
              <tr><td style={TD}>Chybové záznamy (Sentry)</td><td style={TD}>90 dnů</td></tr>
              <tr><td style={TD}>Fakturační záznamy Stripe</td><td style={TD}>Dle zákonných povinností Stripe (daňová legislativa)</td></tr>
              <tr><td style={TD}>Analytická data (PostHog)</td><td style={TD}>12 měsíců</td></tr>
            </tbody>
          </table>
        </div>

        {/* ── 6. Vaše práva ── */}
        <div style={SECTION}>
          <h2 style={H2}>6. Vaše práva podle GDPR</h2>
          <p style={P}>Podle nařízení (EU) 2016/679 (GDPR) máte následující práva:</p>
          <ul style={UL}>
            <li><strong>Právo na přístup (čl. 15)</strong> — můžete požádat o kopii svých osobních údajů.</li>
            <li><strong>Právo na opravu (čl. 16)</strong> — můžete opravit nepřesné údaje.</li>
            <li>
              <strong>Právo na výmaz (čl. 17)</strong> — můžete smazat účet a všechna data.
              V aplikaci: <em>Nastavení → Nebezpečná zóna → Smazat účet</em>.
            </li>
            <li>
              <strong>Právo na přenositelnost (čl. 20)</strong> — můžete si stáhnout kompletní JSON export dat.
              V aplikaci: <em>Nastavení → Export mých dat</em>.
            </li>
            <li><strong>Právo na omezení zpracování (čl. 18)</strong> — za podmínek stanovených GDPR.</li>
            <li><strong>Právo vznést námitku (čl. 21)</strong> — proti zpracování na základě oprávněného zájmu.</li>
            <li><strong>Právo podat stížnost</strong> — u dozorového úřadu: Úřad pro ochranu osobních údajů (ÚOOÚ), Pplk. Sochora 27, 170 00 Praha 7, <a href='https://www.uoou.gov.cz' style={{ color: 'var(--sh-primary)' }}>www.uoou.gov.cz</a>.</li>
          </ul>
          <p style={P}>
            Práva, která nelze uplatnit přímo v aplikaci, vyřídíme na základě žádosti zaslané na{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--sh-primary)' }}>{CONTACT_EMAIL}</a>.
            Na žádost odpovíme nejpozději do 30 dnů.
          </p>
        </div>

        {/* ── 7. Analytika ── */}
        <div style={SECTION}>
          <h2 style={H2}>7. Produktová analytika (PostHog)</h2>
          <p style={P}>
            Pro porozumění způsobu používání služby využíváme PostHog (EU instance).
            Sledujeme agregované události (registrace, skenování, přechod na placený plán),
            nikoliv obsah knihovny, snímky nebo platební údaje.
          </p>
          <p style={P}>
            PostHog pracuje <strong>bez sledovacích cookies</strong>. Pro persistenci analytického
            identifikátoru je využíván localStorage prohlížeče. Právním základem je oprávněný
            zájem správce na vylepšování služby (čl. 6/1f GDPR). Proti tomuto zpracování
            můžete vznést námitku na výše uvedeném kontaktním e-mailu.
          </p>
        </div>

        {/* ── 8. Cookies a localStorage ── */}
        <div style={SECTION}>
          <h2 style={H2}>8. Cookies a místní úložiště</h2>
          <p style={P}>
            Shelfy <strong>nepoužívá sledovací cookies</strong>. Využíváme výhradně:
          </p>
          <ul style={UL}>
            <li><strong>localStorage</strong> — autentizační tokeny, preference jazyka a tmavého režimu. Tato data neopouštějí váš prohlížeč.</li>
            <li><strong>Nezbytné cookies Cloudflare</strong> — technické cookies pro DDoS ochranu (cf_clearance apod.). Ty jsou nezbytné pro fungování služby a nevyžadují souhlas.</li>
          </ul>
        </div>

        {/* ── 9. Zabezpečení ── */}
        <div style={SECTION}>
          <h2 style={H2}>9. Zabezpečení</h2>
          <p style={P}>
            Přijímáme technická a organizační opatření k ochraně vašich údajů:
          </p>
          <ul style={UL}>
            <li>Šifrovaná komunikace (TLS/HTTPS) pro veškerý provoz.</li>
            <li>Hesla ukládána výhradně jako bcrypt hash.</li>
            <li>Přístupové tokeny v paměti prohlížeče (ne v localStorage).</li>
            <li>Infrastruktura za Cloudflare WAF s rate limitingem.</li>
            <li>Pravidelné automatizované zálohy s 30denní rotací.</li>
          </ul>
        </div>

        {/* ── 10. Změny ── */}
        <div style={SECTION}>
          <h2 style={H2}>10. Změny těchto zásad</h2>
          <p style={P}>
            O podstatných změnách vás budeme informovat e-mailem minimálně 14 dní předem.
            Aktuální verzi vždy najdete na této stránce. Drobné formulační úpravy (bez dopadu
            na vaše práva) provádíme bez upozornění.
          </p>
        </div>

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
