/**
 * seedDemoStore — fills `useDemoStore` with the pristine seed library.
 *
 * This is the ONLY production module that may import both the store and
 * `demoSeed`: it is reached exclusively through the lazy-loaded `/demo`
 * chunk (`DemoLayout`), which keeps the ~100-book seed data out of the main
 * bundle that authenticated users download. Tests import it directly to get
 * a deterministic store state per test.
 */
import i18n from 'i18next'

import { useDemoStore } from '../../store/useDemoStore'

import { createDemoBooks, createDemoBorrowers, createDemoLoans, createDemoLocations } from './demoSeed'

/**
 * Reset the demo store to the pristine seed (idempotent, synchronous).
 * Location names follow the current UI language (Czech visitors see
 * "Obývák / Knihovna / Police 1"); tests get the English seed because i18next
 * is not initialised there.
 */
export function seedDemoStore(language: string | undefined = i18n.language): void {
  useDemoStore.getState().applySeed({
    books: createDemoBooks(),
    locations: createDemoLocations(language),
    borrowers: createDemoBorrowers(),
    loans: createDemoLoans(),
  })
}
