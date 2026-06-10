/**
 * Demo seed data — a self-contained, client-side mirror of the backend sample
 * library (`backend/app/services/library.py` `_SAMPLE_LOCATIONS` / `_SAMPLE_BOOKS`).
 *
 * The on-landing demo (#284–#287) runs entirely in the browser so that
 * unauthenticated visitors generate **zero** data/AI/upload load on the server.
 * This module is the single source of truth for that seeded library.
 *
 * Fidelity notes (see #284):
 *  - Every required field of `Book` / `Location` (`lib/types.ts`) is populated
 *    with an explicit value — no `as any`, no missing fields.
 *  - IDs are deterministic (`demo-loc-1`, `demo-book-01`, …) so React keys and
 *    `/demo/:id` links stay stable across reloads.
 *  - Timestamps are a fixed constant (not `Date.now()`) so snapshots/tests are
 *    deterministic.
 *  - The factory functions return **fresh** arrays/objects on every call, so a
 *    `reset()` can never be polluted by in-place demo mutations.
 */
import type { Book, Borrower, Loan, Location, ReadingStatus } from '../../lib/types'

/** Fixed timestamp for all seed rows — keeps demo snapshots deterministic. */
export const DEMO_SEED_TS = '2026-01-01T00:00:00.000Z'

interface SeedLocation {
  id: string
  room: string
  furniture: string
  shelf: string
  display_order: number
}

const SEED_LOCATIONS: readonly SeedLocation[] = [
  { id: 'demo-loc-1', room: 'Living room', furniture: 'Bookcase', shelf: 'Shelf 1', display_order: 1 },
  { id: 'demo-loc-2', room: 'Living room', furniture: 'Bookcase', shelf: 'Shelf 2', display_order: 2 },
  { id: 'demo-loc-3', room: 'Bedroom', furniture: 'Nightstand', shelf: 'To read', display_order: 1 },
  // Expansion shelves. Their display_order continues the global 1..n sequence
  // (instead of restarting per furniture) ON PURPOSE: `shelfOrder` in
  // useDemoStore sorts the flat book list by location display_order, and the
  // original trio already collides (loc-1 vs loc-3 both have order 1). Keeping
  // the new shelves strictly after the existing ones means every pre-expansion
  // page-1 ordering — and the tests pinned to it — stays byte-identical.
  { id: 'demo-loc-4', room: 'Living room', furniture: 'Bookcase', shelf: 'Shelf 3', display_order: 3 },
  { id: 'demo-loc-5', room: 'Living room', furniture: 'Bookcase', shelf: 'Shelf 4', display_order: 4 },
  { id: 'demo-loc-6', room: 'Study', furniture: 'Bookcase', shelf: 'Shelf 1', display_order: 5 },
  { id: 'demo-loc-7', room: 'Study', furniture: 'Bookcase', shelf: 'Shelf 2', display_order: 6 },
] as const

/** [title, author, language, year, reading_status, locationIndex, shelf_position] */
type SeedBook = readonly [string, string, string, number, ReadingStatus, number, number]

const SEED_BOOKS: readonly SeedBook[] = [
  // ── Shelf 1 — Living room / Bookcase (34 books, positions 0–33) ──
  ['Proměna', 'Franz Kafka', 'cs', 1915, 'read', 0, 0],
  ['R.U.R.', 'Karel Čapek', 'cs', 1920, 'read', 0, 1],
  ['Ostře sledované vlaky', 'Bohumil Hrabal', 'cs', 1965, 'read', 0, 2],
  ['Báječná léta pod psa', 'Michal Viewegh', 'cs', 1992, 'reading', 0, 3],
  ['Zaklínač I: Poslední přání', 'Andrzej Sapkowski', 'cs', 1990, 'reading', 0, 4],
  ['Hobit', 'J.R.R. Tolkien', 'cs', 1937, 'read', 0, 5],
  ['Krakatit', 'Karel Čapek', 'cs', 1924, 'read', 0, 6],
  ['Bílá nemoc', 'Karel Čapek', 'cs', 1937, 'read', 0, 7],
  ['Saturnin', 'Zdeněk Jirotka', 'cs', 1942, 'read', 0, 8],
  ['Válka s mloky', 'Karel Čapek', 'cs', 1936, 'read', 0, 9],
  ['Bylo nás pět', 'Karel Poláček', 'cs', 1946, 'read', 0, 10],
  ['Babička', 'Božena Němcová', 'cs', 1855, 'read', 0, 11],
  ['Romeo a Julie', 'William Shakespeare', 'cs', 1597, 'read', 0, 12],
  ['Hamlet', 'William Shakespeare', 'cs', 1603, 'read', 0, 13],
  ['Velký Gatsby', 'F. Scott Fitzgerald', 'cs', 1925, 'read', 0, 14],
  ['Na cestě', 'Jack Kerouac', 'cs', 1957, 'reading', 0, 15],
  ['Kdo chytá v žitě', 'J.D. Salinger', 'cs', 1951, 'read', 0, 16],
  ['Pýcha a předsudek', 'Jane Austen', 'cs', 1813, 'read', 0, 17],
  ['Jana Eyrová', 'Charlotte Brontëová', 'cs', 1847, 'read', 0, 18],
  ['Na Větrné hůrce', 'Emily Brontëová', 'cs', 1847, 'unread', 0, 19],
  ['Tři mušketýři', 'Alexandre Dumas', 'cs', 1844, 'read', 0, 20],
  ['Hrabě Monte Cristo', 'Alexandre Dumas', 'cs', 1845, 'reading', 0, 21],
  ['Bídníci', 'Victor Hugo', 'cs', 1862, 'unread', 0, 22],
  ['Anna Kareninová', 'Lev Nikolajevič Tolstoj', 'cs', 1877, 'unread', 0, 23],
  ['Vojna a mír', 'Lev Nikolajevič Tolstoj', 'cs', 1869, 'unread', 0, 24],
  ['Idiot', 'Fjodor Michajlovič Dostojevský', 'cs', 1869, 'unread', 0, 25],
  ['Bratři Karamazovi', 'Fjodor Michajlovič Dostojevský', 'cs', 1880, 'unread', 0, 26],
  ['Lakomec', 'Molière', 'cs', 1668, 'read', 0, 27],
  ['Faust', 'Johann Wolfgang von Goethe', 'cs', 1808, 'unread', 0, 28],
  ['Proces', 'Franz Kafka', 'cs', 1925, 'read', 0, 29],
  ['Zámek', 'Franz Kafka', 'cs', 1926, 'unread', 0, 30],
  ['Cizinec', 'Albert Camus', 'cs', 1942, 'read', 0, 31],
  ['Mor', 'Albert Camus', 'cs', 1947, 'reading', 0, 32],
  ['Stařec a moře', 'Ernest Hemingway', 'cs', 1952, 'read', 0, 33],

  // ── Shelf 2 — Living room / Bookcase (33 books, positions 0–32) ──
  ['Nesnesitelná lehkost bytí', 'Milan Kundera', 'cs', 1984, 'read', 1, 0],
  ['Osudy dobrého vojáka Švejka', 'Jaroslav Hašek', 'cs', 1923, 'read', 1, 1],
  ['1984', 'George Orwell', 'en', 1949, 'read', 1, 2],
  ['Stopařův průvodce po galaxii', 'Douglas Adams', 'en', 1979, 'read', 1, 3],
  ['Malý princ', 'Antoine de Saint-Exupéry', 'cs', 1943, 'read', 1, 4],
  ['Farma zvířat', 'George Orwell', 'cs', 1945, 'read', 1, 5],
  ['451 stupňů Fahrenheita', 'Ray Bradbury', 'cs', 1953, 'read', 1, 6],
  ['Marťanská kronika', 'Ray Bradbury', 'cs', 1950, 'reading', 1, 7],
  ['Nadace', 'Isaac Asimov', 'cs', 1951, 'unread', 1, 8],
  ['Já, robot', 'Isaac Asimov', 'cs', 1950, 'read', 1, 9],
  ['Konec dětství', 'Arthur C. Clarke', 'cs', 1953, 'unread', 1, 10],
  ['2001: Vesmírná odysea', 'Arthur C. Clarke', 'cs', 1968, 'unread', 1, 11],
  ['Solaris', 'Stanisław Lem', 'cs', 1961, 'unread', 1, 12],
  ['Kyberiáda', 'Stanisław Lem', 'cs', 1965, 'unread', 1, 13],
  ['Neuromancer', 'William Gibson', 'cs', 1984, 'unread', 1, 14],
  ['Sní androidi o elektrických ovečkách?', 'Philip K. Dick', 'cs', 1968, 'unread', 1, 15],
  ['Hra o trůny', 'George R.R. Martin', 'cs', 1996, 'reading', 1, 16],
  ['Jméno větru', 'Patrick Rothfuss', 'cs', 2007, 'read', 1, 17],
  ['Enderova hra', 'Orson Scott Card', 'cs', 1985, 'read', 1, 18],
  ['Hyperion', 'Dan Simmons', 'cs', 1989, 'unread', 1, 19],
  ['Zaklínač II: Meč osudu', 'Andrzej Sapkowski', 'cs', 1992, 'reading', 1, 20],
  ['Krev elfů', 'Andrzej Sapkowski', 'cs', 1994, 'unread', 1, 21],
  ['Pán prstenů: Dvě věže', 'J.R.R. Tolkien', 'cs', 1954, 'read', 1, 22],
  ['Pán prstenů: Návrat krále', 'J.R.R. Tolkien', 'cs', 1955, 'read', 1, 23],
  ['Silmarillion', 'J.R.R. Tolkien', 'cs', 1977, 'unread', 1, 24],
  ['Harry Potter a Kámen mudrců', 'J.K. Rowlingová', 'cs', 1997, 'read', 1, 25],
  ['Harry Potter a Tajemná komnata', 'J.K. Rowlingová', 'cs', 1998, 'read', 1, 26],
  ['Lev, čarodějnice a skříň', 'C.S. Lewis', 'cs', 1950, 'read', 1, 27],
  ['Hvězdný prach', 'Neil Gaiman', 'cs', 1999, 'reading', 1, 28],
  ['Američtí bohové', 'Neil Gaiman', 'cs', 2001, 'unread', 1, 29],
  ['Dobrá znamení', 'Terry Pratchett', 'cs', 1990, 'read', 1, 30],
  ['Barva kouzel', 'Terry Pratchett', 'cs', 1983, 'read', 1, 31],
  ['Mort', 'Terry Pratchett', 'cs', 1987, 'reading', 1, 32],

  // ── To read — Bedroom / Nightstand (33 books, positions 0–32) ──
  ['Zločin a trest', 'Fjodor Michajlovič Dostojevský', 'cs', 1866, 'unread', 2, 0],
  ['Sto roků samoty', 'Gabriel García Márquez', 'cs', 1967, 'unread', 2, 1],
  ['Mistr a Markétka', 'Michail Bulgakov', 'cs', 1967, 'unread', 2, 2],
  ['Duna', 'Frank Herbert', 'cs', 1965, 'unread', 2, 3],
  ['Pán prstenů: Společenstvo prstenu', 'J.R.R. Tolkien', 'cs', 1954, 'unread', 2, 4],
  ['Jméno růže', 'Umberto Eco', 'cs', 1980, 'unread', 2, 5],
  ['Foucaultovo kyvadlo', 'Umberto Eco', 'cs', 1988, 'unread', 2, 6],
  ['Stoletý stařík, který vylezl z okna a zmizel', 'Jonas Jonasson', 'cs', 2009, 'unread', 2, 7],
  ['Muž jménem Ove', 'Fredrik Backman', 'cs', 2012, 'unread', 2, 8],
  ['Pět lidí, které potkáte v nebi', 'Mitch Albom', 'cs', 2003, 'unread', 2, 9],
  ['Kafka na pobřeží', 'Haruki Murakami', 'cs', 2002, 'unread', 2, 10],
  ['Norské dřevo', 'Haruki Murakami', 'cs', 1987, 'reading', 2, 11],
  ['1Q84', 'Haruki Murakami', 'cs', 2009, 'unread', 2, 12],
  ['Lovec draků', 'Khaled Hosseini', 'cs', 2003, 'unread', 2, 13],
  ['Tisíce planoucích sluncí', 'Khaled Hosseini', 'cs', 2007, 'unread', 2, 14],
  ['Pí a jeho život', 'Yann Martel', 'cs', 2001, 'unread', 2, 15],
  ['Oko světa', 'Robert Jordan', 'cs', 1990, 'unread', 2, 16],
  ['Šifra mistra Leonarda', 'Dan Brown', 'cs', 2003, 'read', 2, 17],
  ['Andělé a démoni', 'Dan Brown', 'cs', 2000, 'read', 2, 18],
  ['Muži, kteří nenávidí ženy', 'Stieg Larsson', 'cs', 2005, 'unread', 2, 19],
  ['Mlčení jehňátek', 'Thomas Harris', 'cs', 1988, 'unread', 2, 20],
  ['To', 'Stephen King', 'cs', 1986, 'unread', 2, 21],
  ['Osvícení', 'Stephen King', 'cs', 1977, 'unread', 2, 22],
  ['Zelená míle', 'Stephen King', 'cs', 1996, 'unread', 2, 23],
  ['Pistolník', 'Stephen King', 'cs', 1982, 'unread', 2, 24],
  ['Pokání', 'Ian McEwan', 'cs', 2001, 'unread', 2, 25],
  ['Skleněný hrad', 'Jeannette Walls', 'cs', 2005, 'unread', 2, 26],
  ['Stín větru', 'Carlos Ruiz Zafón', 'cs', 2001, 'unread', 2, 27],
  ['Parfém: Příběh vraha', 'Patrick Süskind', 'cs', 1985, 'read', 2, 28],
  ['Alchymista', 'Paulo Coelho', 'cs', 1988, 'read', 2, 29],
  ['Veronika se rozhodla zemřít', 'Paulo Coelho', 'cs', 1998, 'unread', 2, 30],
  ['Žít!', 'Jü Chua', 'cs', 1993, 'unread', 2, 31],
  ['Snídaně u Tiffanyho', 'Truman Capote', 'cs', 1958, 'unread', 2, 32],

  // ── Shelf 3 — Living room / Bookcase (43 books, positions 0–42) ──
  // Czech literature, classics to contemporary.
  ['Kytice', 'Karel Jaromír Erben', 'cs', 1853, 'read', 3, 0],
  ['Máj', 'Karel Hynek Mácha', 'cs', 1836, 'read', 3, 1],
  ['Povídky malostranské', 'Jan Neruda', 'cs', 1877, 'read', 3, 2],
  ['Divá Bára', 'Božena Němcová', 'cs', 1856, 'unread', 3, 3],
  ['Postřižiny', 'Bohumil Hrabal', 'cs', 1976, 'read', 3, 4],
  ['Obsluhoval jsem anglického krále', 'Bohumil Hrabal', 'cs', 1971, 'read', 3, 5],
  ['Příliš hlučná samota', 'Bohumil Hrabal', 'cs', 1976, 'read', 3, 6],
  ['Žert', 'Milan Kundera', 'cs', 1967, 'read', 3, 7],
  ['Směšné lásky', 'Milan Kundera', 'cs', 1969, 'unread', 3, 8],
  ['Valčík na rozloučenou', 'Milan Kundera', 'cs', 1972, 'unread', 3, 9],
  ['Spalovač mrtvol', 'Ladislav Fuks', 'cs', 1967, 'read', 3, 10],
  ['Pan Theodor Mundstock', 'Ladislav Fuks', 'cs', 1963, 'unread', 3, 11],
  ['Smrt krásných srnců', 'Ota Pavel', 'cs', 1971, 'read', 3, 12],
  ['Jak jsem potkal ryby', 'Ota Pavel', 'cs', 1974, 'read', 3, 13],
  ['Rozmarné léto', 'Vladislav Vančura', 'cs', 1926, 'read', 3, 14],
  ['Markéta Lazarová', 'Vladislav Vančura', 'cs', 1931, 'unread', 3, 15],
  ['Krysař', 'Viktor Dyk', 'cs', 1915, 'read', 3, 16],
  ['Romeo, Julie a tma', 'Jan Otčenášek', 'cs', 1958, 'unread', 3, 17],
  ['Zbabělci', 'Josef Škvorecký', 'cs', 1958, 'read', 3, 18],
  ['Tankový prapor', 'Josef Škvorecký', 'cs', 1971, 'unread', 3, 19],
  ['Sestra', 'Jáchym Topol', 'cs', 1994, 'unread', 3, 20],
  ['Hrdý Budžes', 'Irena Dousková', 'cs', 1998, 'read', 3, 21],
  ['Želary', 'Květa Legátová', 'cs', 2001, 'unread', 3, 22],
  ['Vyhnání Gerty Schnirch', 'Kateřina Tučková', 'cs', 2009, 'read', 3, 23],
  ['Žítkovské bohyně', 'Kateřina Tučková', 'cs', 2012, 'read', 3, 24],
  ['Hana', 'Alena Mornštajnová', 'cs', 2017, 'read', 3, 25],
  ['Slepá mapa', 'Alena Mornštajnová', 'cs', 2013, 'unread', 3, 26],
  ['Listopád', 'Alena Mornštajnová', 'cs', 2021, 'unread', 3, 27],
  ['Šikmý kostel', 'Karin Lednická', 'cs', 2020, 'read', 3, 28],
  ['Gump: Pes, který naučil lidi žít', 'Filip Rožek', 'cs', 2019, 'unread', 3, 29],
  ['Bábovky', 'Radka Třeštíková', 'cs', 2016, 'read', 3, 30],
  ['Osm', 'Radka Třeštíková', 'cs', 2017, 'unread', 3, 31],
  ['Dějiny světla', 'Jan Němec', 'cs', 2013, 'unread', 3, 32],
  ['Petrolejové lampy', 'Jaroslav Havlíček', 'cs', 1935, 'unread', 3, 33],
  ['Neviditelný', 'Jaroslav Havlíček', 'cs', 1937, 'unread', 3, 34],
  ['Turbina', 'Karel Matěj Čapek-Chod', 'cs', 1916, 'unread', 3, 35],
  ['Maryša', 'Alois a Vilém Mrštíkové', 'cs', 1894, 'read', 3, 36],
  ['Naši furianti', 'Ladislav Stroupežnický', 'cs', 1887, 'unread', 3, 37],
  ['Lucerna', 'Alois Jirásek', 'cs', 1905, 'read', 3, 38],
  ['Staré pověsti české', 'Alois Jirásek', 'cs', 1894, 'read', 3, 39],
  ['Psohlavci', 'Alois Jirásek', 'cs', 1884, 'unread', 3, 40],
  ['F. L. Věk', 'Alois Jirásek', 'cs', 1890, 'unread', 3, 41],
  ['Temno', 'Alois Jirásek', 'cs', 1915, 'unread', 3, 42],

  // ── Shelf 4 — Living room / Bookcase (43 books, positions 0–42) ──
  // World fiction, detective stories, adventure classics.
  ['A pak nezbyl žádný', 'Agatha Christie', 'cs', 1939, 'read', 4, 0],
  ['Vražda v Orient-expresu', 'Agatha Christie', 'cs', 1934, 'read', 4, 1],
  ['Smrt na Nilu', 'Agatha Christie', 'cs', 1937, 'read', 4, 2],
  ['Pes baskervillský', 'Arthur Conan Doyle', 'cs', 1902, 'read', 4, 3],
  ['Studie v šarlatové', 'Arthur Conan Doyle', 'cs', 1887, 'unread', 4, 4],
  ['Velký spánek', 'Raymond Chandler', 'cs', 1939, 'unread', 4, 5],
  ['Maltézský sokol', 'Dashiell Hammett', 'cs', 1930, 'unread', 4, 6],
  ['Dívka ve vlaku', 'Paula Hawkins', 'cs', 2015, 'read', 4, 7],
  ['Zmizelá', 'Gillian Flynn', 'cs', 2012, 'read', 4, 8],
  ['Inferno', 'Dan Brown', 'cs', 2013, 'unread', 4, 9],
  ['Ztracený symbol', 'Dan Brown', 'cs', 2009, 'unread', 4, 10],
  ['Dívka, která si hrála s ohněm', 'Stieg Larsson', 'cs', 2006, 'unread', 4, 11],
  ['Sněhulák', 'Jo Nesbø', 'cs', 2007, 'read', 4, 12],
  ['Netopýr', 'Jo Nesbø', 'cs', 1997, 'unread', 4, 13],
  ['Případ Collini', 'Ferdinand von Schirach', 'cs', 2011, 'unread', 4, 14],
  ['Tichý pacient', 'Alex Michaelides', 'cs', 2019, 'read', 4, 15],
  ['Sedm sester', 'Lucinda Riley', 'cs', 2014, 'unread', 4, 16],
  ['Kde zpívají raci', 'Delia Owens', 'cs', 2018, 'read', 4, 17],
  ['Půlnoční knihovna', 'Matt Haig', 'cs', 2020, 'read', 4, 18],
  ['Lekce chemie', 'Bonnie Garmus', 'cs', 2022, 'unread', 4, 19],
  ['Spolčení hlupců', 'John Kennedy Toole', 'cs', 1980, 'unread', 4, 20],
  ['Lolita', 'Vladimir Nabokov', 'cs', 1955, 'unread', 4, 21],
  ['Doktor Živago', 'Boris Pasternak', 'cs', 1957, 'unread', 4, 22],
  ['Vinnetou', 'Karl May', 'cs', 1893, 'read', 4, 23],
  ['Ostrov pokladů', 'Robert Louis Stevenson', 'cs', 1883, 'read', 4, 24],
  ['Robinson Crusoe', 'Daniel Defoe', 'cs', 1719, 'read', 4, 25],
  ['Gulliverovy cesty', 'Jonathan Swift', 'cs', 1726, 'unread', 4, 26],
  ['Dvacet tisíc mil pod mořem', 'Jules Verne', 'cs', 1870, 'read', 4, 27],
  ['Cesta kolem světa za osmdesát dní', 'Jules Verne', 'cs', 1872, 'read', 4, 28],
  ['Tajuplný ostrov', 'Jules Verne', 'cs', 1874, 'unread', 4, 29],
  ['Děti kapitána Granta', 'Jules Verne', 'cs', 1868, 'unread', 4, 30],
  ['Bílý tesák', 'Jack London', 'cs', 1906, 'read', 4, 31],
  ['Volání divočiny', 'Jack London', 'cs', 1903, 'read', 4, 32],
  ['Moby Dick', 'Herman Melville', 'cs', 1851, 'unread', 4, 33],
  ['Dobrodružství Toma Sawyera', 'Mark Twain', 'cs', 1876, 'read', 4, 34],
  ['Dobrodružství Huckleberryho Finna', 'Mark Twain', 'cs', 1884, 'unread', 4, 35],
  ['Jih proti Severu', 'Margaret Mitchellová', 'cs', 1936, 'unread', 4, 36],
  ['Mrtvá a živá', 'Daphne du Maurier', 'cs', 1938, 'unread', 4, 37],
  ['Nadějné vyhlídky', 'Charles Dickens', 'cs', 1861, 'unread', 4, 38],
  ['Oliver Twist', 'Charles Dickens', 'cs', 1838, 'read', 4, 39],
  ['Vánoční koleda', 'Charles Dickens', 'cs', 1843, 'read', 4, 40],
  ['Obraz Doriana Graye', 'Oscar Wilde', 'cs', 1890, 'read', 4, 41],
  ['Dracula', 'Bram Stoker', 'cs', 1897, 'unread', 4, 42],

  // ── Shelf 1 — Study / Bookcase (43 books, positions 0–42) ──
  // Non-fiction, 20th-century landmarks, more sci-fi & fantasy.
  ['Sapiens', 'Yuval Noah Harari', 'cs', 2011, 'read', 5, 0],
  ['Homo Deus', 'Yuval Noah Harari', 'cs', 2015, 'unread', 5, 1],
  ['21 lekcí pro 21. století', 'Yuval Noah Harari', 'cs', 2018, 'unread', 5, 2],
  ['Stručná historie času', 'Stephen Hawking', 'cs', 1988, 'read', 5, 3],
  ['Sobecký gen', 'Richard Dawkins', 'cs', 1976, 'unread', 5, 4],
  ['Myšlení rychlé a pomalé', 'Daniel Kahneman', 'cs', 2011, 'read', 5, 5],
  ['Černá labuť', 'Nassim Nicholas Taleb', 'cs', 2007, 'unread', 5, 6],
  ['Atomové návyky', 'James Clear', 'cs', 2018, 'read', 5, 7],
  ['7 návyků skutečně efektivních lidí', 'Stephen R. Covey', 'cs', 1989, 'unread', 5, 8],
  ['Zlodějka knih', 'Markus Zusak', 'cs', 2005, 'read', 5, 9],
  ['Chlapec v pruhovaném pyžamu', 'John Boyne', 'cs', 2006, 'read', 5, 10],
  ['Deník Anne Frankové', 'Anne Franková', 'cs', 1947, 'read', 5, 11],
  ['Maus', 'Art Spiegelman', 'cs', 1991, 'unread', 5, 12],
  ['Přelet nad kukaččím hnízdem', 'Ken Kesey', 'cs', 1962, 'read', 5, 13],
  ['Hlava XXII', 'Joseph Heller', 'cs', 1961, 'unread', 5, 14],
  ['Jatka č. 5', 'Kurt Vonnegut', 'cs', 1969, 'read', 5, 15],
  ['Kolíbka', 'Kurt Vonnegut', 'cs', 1963, 'unread', 5, 16],
  ['Mechanický pomeranč', 'Anthony Burgess', 'cs', 1962, 'unread', 5, 17],
  ['Pán much', 'William Golding', 'cs', 1954, 'read', 5, 18],
  ['Konec civilizace', 'Aldous Huxley', 'cs', 1932, 'read', 5, 19],
  ['My', 'Jevgenij Zamjatin', 'cs', 1924, 'unread', 5, 20],
  ['Příběh služebnice', 'Margaret Atwoodová', 'cs', 1985, 'read', 5, 21],
  ['Slepota', 'José Saramago', 'cs', 1995, 'unread', 5, 22],
  ['Neopouštěj mě', 'Kazuo Ishiguro', 'cs', 2005, 'unread', 5, 23],
  ['Soumrak dne', 'Kazuo Ishiguro', 'cs', 1989, 'unread', 5, 24],
  ['Klára a Slunce', 'Kazuo Ishiguro', 'cs', 2021, 'unread', 5, 25],
  ['Marťan', 'Andy Weir', 'cs', 2011, 'read', 5, 26],
  ['Projekt Hail Mary', 'Andy Weir', 'cs', 2021, 'read', 5, 27],
  ['Problém tří těles', 'Liou Cch’-sin', 'cs', 2008, 'read', 5, 28],
  ['Temný les', 'Liou Cch’-sin', 'cs', 2008, 'unread', 5, 29],
  ['Vzpomínka na Zemi: Konec smrti', 'Liou Cch’-sin', 'cs', 2010, 'unread', 5, 30],
  ['Leviatan se probouzí', 'James S. A. Corey', 'cs', 2011, 'unread', 5, 31],
  ['Mluvčí za mrtvé', 'Orson Scott Card', 'cs', 1986, 'unread', 5, 32],
  ['Stráže! Stráže!', 'Terry Pratchett', 'cs', 1989, 'read', 5, 33],
  ['Soudné sestry', 'Terry Pratchett', 'cs', 1988, 'read', 5, 34],
  ['Malí bohové', 'Terry Pratchett', 'cs', 1992, 'unread', 5, 35],
  ['Nikdykde', 'Neil Gaiman', 'cs', 1996, 'unread', 5, 36],
  ['Koralina', 'Neil Gaiman', 'cs', 2002, 'read', 5, 37],
  ['Kniha hřbitova', 'Neil Gaiman', 'cs', 2008, 'unread', 5, 38],
  ['Eragon', 'Christopher Paolini', 'cs', 2002, 'read', 5, 39],
  ['Percy Jackson: Zloděj blesku', 'Rick Riordan', 'cs', 2005, 'read', 5, 40],
  ['Hunger Games: Aréna smrti', 'Suzanne Collinsová', 'cs', 2008, 'read', 5, 41],
  ['Labyrint: Útěk', 'James Dashner', 'cs', 2009, 'unread', 5, 42],

  // ── Shelf 2 — Study / Bookcase (42 books, positions 0–41) ──
  // Children's classics, Czech childhood staples, war & historical fiction.
  ['Mikulášovy patálie', 'René Goscinny', 'cs', 1959, 'read', 6, 0],
  ['Pipi Dlouhá punčocha', 'Astrid Lindgrenová', 'cs', 1945, 'read', 6, 1],
  ['Děti z Bullerbynu', 'Astrid Lindgrenová', 'cs', 1947, 'read', 6, 2],
  ['Ronja, dcera loupežníka', 'Astrid Lindgrenová', 'cs', 1981, 'read', 6, 3],
  ['Bratři Lví srdce', 'Astrid Lindgrenová', 'cs', 1973, 'unread', 6, 4],
  ['Medvídek Pú', 'A. A. Milne', 'cs', 1926, 'read', 6, 5],
  ['Alenka v říši divů', 'Lewis Carroll', 'cs', 1865, 'read', 6, 6],
  ['Čarodějův učeň', 'Otfried Preußler', 'cs', 1971, 'unread', 6, 7],
  ['Malá čarodějnice', 'Otfried Preußler', 'cs', 1957, 'read', 6, 8],
  ['Fimfárum', 'Jan Werich', 'cs', 1960, 'read', 6, 9],
  ['Dášeňka čili život štěněte', 'Karel Čapek', 'cs', 1933, 'read', 6, 10],
  ['Povídání o pejskovi a kočičce', 'Josef Čapek', 'cs', 1929, 'read', 6, 11],
  ['Ferda Mravenec', 'Ondřej Sekora', 'cs', 1936, 'read', 6, 12],
  ['Rychlé šípy', 'Jaroslav Foglar', 'cs', 1938, 'read', 6, 13],
  ['Hoši od Bobří řeky', 'Jaroslav Foglar', 'cs', 1937, 'read', 6, 14],
  ['Záhada hlavolamu', 'Jaroslav Foglar', 'cs', 1940, 'read', 6, 15],
  ['Honzíkova cesta', 'Bohumil Říha', 'cs', 1954, 'read', 6, 16],
  ['Mach a Šebestová', 'Miloš Macourek', 'cs', 1982, 'read', 6, 17],
  ['Lovci mamutů', 'Eduard Štorch', 'cs', 1918, 'read', 6, 18],
  ['Osada Havranů', 'Eduard Štorch', 'cs', 1930, 'unread', 6, 19],
  ['Robinsonka', 'Marie Majerová', 'cs', 1940, 'unread', 6, 20],
  ['Školák Kája Mařík', 'Felix Háj', 'cs', 1926, 'unread', 6, 21],
  ['Egypťan Sinuhet', 'Mika Waltari', 'cs', 1945, 'read', 6, 22],
  ['Quo vadis', 'Henryk Sienkiewicz', 'cs', 1896, 'unread', 6, 23],
  ['Křižáci', 'Henryk Sienkiewicz', 'cs', 1900, 'unread', 6, 24],
  ['Já, Claudius', 'Robert Graves', 'cs', 1934, 'unread', 6, 25],
  ['Hadriánovy paměti', 'Marguerite Yourcenarová', 'cs', 1951, 'unread', 6, 26],
  ['Tři kamarádi', 'Erich Maria Remarque', 'cs', 1936, 'read', 6, 27],
  ['Na západní frontě klid', 'Erich Maria Remarque', 'cs', 1929, 'read', 6, 28],
  ['Černý obelisk', 'Erich Maria Remarque', 'cs', 1956, 'unread', 6, 29],
  ['Sofiina volba', 'William Styron', 'cs', 1979, 'unread', 6, 30],
  ['Schindlerův seznam', 'Thomas Keneally', 'cs', 1982, 'unread', 6, 31],
  ['Komu zvoní hrana', 'Ernest Hemingway', 'cs', 1940, 'unread', 6, 32],
  ['Sbohem, armádo!', 'Ernest Hemingway', 'cs', 1929, 'unread', 6, 33],
  ['Fiesta (I slunce vychází)', 'Ernest Hemingway', 'cs', 1926, 'unread', 6, 34],
  ['O myších a lidech', 'John Steinbeck', 'cs', 1937, 'read', 6, 35],
  ['Hrozny hněvu', 'John Steinbeck', 'cs', 1939, 'unread', 6, 36],
  ['Na východ od ráje', 'John Steinbeck', 'cs', 1952, 'unread', 6, 37],
  ['Ptáci v trní', 'Colleen McCulloughová', 'cs', 1977, 'unread', 6, 38],
  ['Vejce a já', 'Betty MacDonaldová', 'cs', 1945, 'read', 6, 39],
  ['Co život dal a vzal', 'Betty MacDonaldová', 'cs', 1955, 'unread', 6, 40],
  ['Saturnin se vrací', 'Miroslav Macek', 'cs', 2017, 'unread', 6, 41],
] as const

// ── Borrowers & loans (#284 follow-up) ──────────────────────────────────────
//
// Mirrors the real borrowers/loans feature client-side so the demo can show a
// populated "Borrowers" view and a working lend / return lifecycle — still with
// zero backend/AI load. Anonymize / merge are intentionally NOT seeded or
// exposed in the demo (they're hidden in the UI), so every borrower row here is
// a plain, active record (no `anonymized_at`, no `pending_anonymization_until`).

interface SeedBorrower {
  id: string
  name: string
  contact: string | null
  notes: string | null
}

const SEED_BORROWERS: readonly SeedBorrower[] = [
  { id: 'demo-borrower-1', name: 'Jana Nováková', contact: 'jana.novakova@email.cz', notes: 'Kolegyně z práce, vrací včas.' },
  // Phone is the reserved-looking dummy 123 456 789 — never a real number.
  { id: 'demo-borrower-2', name: 'Petr Svoboda', contact: '+420 123 456 789', notes: null },
  { id: 'demo-borrower-3', name: 'Lucie Dvořáková', contact: 'lucie.dvorakova@email.cz', notes: null },
  { id: 'demo-borrower-4', name: 'Tomáš Procházka', contact: null, notes: 'Soused odvedle.' },
] as const

type ReturnCondition = NonNullable<Loan['return_condition']>

/** [id, bookId, borrowerId, lentDate, dueDate, returnedDate, returnCondition, notes] */
type SeedLoan = readonly [
  string,
  string,
  string,
  string,
  string | null,
  string | null,
  ReturnCondition | null,
  string | null,
]

const SEED_LOANS: readonly SeedLoan[] = [
  // ── Active loans (currently out) ──
  ['demo-loan-1', 'demo-book-06', 'demo-borrower-1', '2026-05-20', '2026-06-20', null, null, null],
  ['demo-loan-2', 'demo-book-37', 'demo-borrower-2', '2026-05-28', '2026-06-15', null, null, 'Půjčeno na dovolenou.'],
  ['demo-loan-3', 'demo-book-51', 'demo-borrower-1', '2026-06-02', '2026-07-02', null, null, null],
  // ── Returned loans (history) ──
  ['demo-loan-4', 'demo-book-01', 'demo-borrower-3', '2026-03-01', '2026-03-21', '2026-03-22', 'good', null],
  ['demo-loan-5', 'demo-book-71', 'demo-borrower-2', '2026-02-10', '2026-03-01', '2026-03-05', 'perfect', null],
  ['demo-loan-6', 'demo-book-85', 'demo-borrower-4', '2026-04-15', '2026-05-15', '2026-05-10', 'fair', 'Trochu ohnutý roh.'],
  ['demo-loan-7', 'demo-book-28', 'demo-borrower-1', '2026-01-05', '2026-02-05', '2026-02-01', 'good', null],
] as const

/** Build a fresh array of seed borrowers (new objects every call). */
export function createDemoBorrowers(): Borrower[] {
  return SEED_BORROWERS.map((b) => ({
    id: b.id,
    name: b.name,
    contact: b.contact,
    notes: b.notes,
    anonymized_at: null,
    pending_anonymization_until: null,
    created_by_user_id: null,
    anonymized_by_user_id: null,
    merged_into_by_user_id: null,
    created_at: DEMO_SEED_TS,
    updated_at: DEMO_SEED_TS,
  }))
}

/** Build a fresh array of seed loans, denormalizing the borrower snapshot. */
export function createDemoLoans(): Loan[] {
  const byId = new Map(createDemoBorrowers().map((b) => [b.id, b]))
  return SEED_LOANS.map(([id, bookId, borrowerId, lentDate, dueDate, returnedDate, returnCondition, notes]) => {
    const borrower = byId.get(borrowerId) ?? null
    return {
      id,
      book_id: bookId,
      borrower_id: borrowerId,
      borrower_name: borrower?.name ?? '',
      borrower_contact: borrower?.contact ?? null,
      borrower,
      lent_date: lentDate,
      due_date: dueDate,
      returned_date: returnedDate,
      return_condition: returnCondition,
      notes,
      created_at: `${lentDate}T00:00:00.000Z`,
      is_active: returnedDate === null,
    }
  })
}

/** Build a fresh array of seed locations (new objects every call). */
export function createDemoLocations(): Location[] {
  return SEED_LOCATIONS.map((loc) => ({
    id: loc.id,
    room: loc.room,
    furniture: loc.furniture,
    shelf: loc.shelf,
    display_order: loc.display_order,
    is_sample: true,
    created_at: DEMO_SEED_TS,
    updated_at: DEMO_SEED_TS,
  }))
}

/** Build a fresh array of seed books (new objects every call). */
export function createDemoBooks(): Book[] {
  // Reflect the seeded lending state: books with an active (un-returned) loan
  // render as "currently lent" and carry their active loan on the book object,
  // exactly like the backend's `Book` payload.
  const activeLoanByBook = new Map(
    createDemoLoans().filter((l) => l.is_active).map((l) => [l.book_id, l]),
  )
  return SEED_BOOKS.map(([title, author, language, year, readingStatus, locIdx, shelfPos], index) => {
    const id = `demo-book-${String(index + 1).padStart(2, '0')}`
    const activeLoan = activeLoanByBook.get(id) ?? null
    return {
      id,
      title,
      author,
      isbn: null,
      publisher: null,
      language,
      description: null,
      publication_year: year,
      cover_image_url: null,
      location_id: SEED_LOCATIONS[locIdx].id,
      shelf_position: shelfPos,
      processing_status: 'done',
      reading_status: readingStatus,
      is_currently_lent: activeLoan !== null,
      active_loan: activeLoan,
      is_sample: true,
      created_at: DEMO_SEED_TS,
      updated_at: DEMO_SEED_TS,
    }
  })
}
