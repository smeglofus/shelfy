import { describe, expect, it } from 'vitest'

import { createDemoLocations } from './demoSeed'

describe('createDemoLocations — localized names', () => {
  it('keeps the English seed by default (tests and English visitors)', () => {
    const [first] = createDemoLocations()
    expect(first).toMatchObject({ room: 'Living room', furniture: 'Bookcase', shelf: 'Shelf 1' })
    expect(createDemoLocations('en')[2]).toMatchObject({ room: 'Bedroom', shelf: 'To read' })
  })

  it('translates every location to Czech for Czech visitors', () => {
    const locations = createDemoLocations('cs')
    expect(locations[0]).toMatchObject({ room: 'Obývák', furniture: 'Knihovna', shelf: 'Police 1' })
    expect(locations[2]).toMatchObject({ room: 'Ložnice', furniture: 'Noční stolek', shelf: 'K přečtení' })
    expect(locations[5]).toMatchObject({ room: 'Pracovna', shelf: 'Police 1' })
    const english = /Living room|Bedroom|Study|Bookcase|Nightstand|Shelf|To read/
    for (const loc of locations) {
      expect(`${loc.room} ${loc.furniture} ${loc.shelf}`).not.toMatch(english)
    }
  })

  it('keeps ids stable across languages', () => {
    expect(createDemoLocations('cs').map((l) => l.id)).toEqual(createDemoLocations('en').map((l) => l.id))
  })
})
