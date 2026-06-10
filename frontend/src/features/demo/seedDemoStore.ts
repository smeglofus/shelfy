/**
 * seedDemoStore — fills `useDemoStore` with the pristine seed library.
 *
 * This is the ONLY production module that may import both the store and
 * `demoSeed`: it is reached exclusively through the lazy-loaded `/demo`
 * chunk (`DemoLayout`), which keeps the ~100-book seed data out of the main
 * bundle that authenticated users download. Tests import it directly to get
 * a deterministic store state per test.
 */
import { useDemoStore } from '../../store/useDemoStore'

import { createDemoBooks, createDemoBorrowers, createDemoLoans, createDemoLocations } from './demoSeed'

/** Reset the demo store to the pristine seed (idempotent, synchronous). */
export function seedDemoStore(): void {
  useDemoStore.getState().applySeed({
    books: createDemoBooks(),
    locations: createDemoLocations(),
    borrowers: createDemoBorrowers(),
    loans: createDemoLoans(),
  })
}
