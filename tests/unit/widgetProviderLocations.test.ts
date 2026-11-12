import { afterEach, describe, expect, it, vi } from 'vitest'
import { liveProviderLocations, withSharedValues } from '../../widget/src/providerLocations.js'

/**
 * A provider keeps their booking link and phone for a location after archiving
 * their last offering there, so restoring the offering brings them back. The
 * widget must not offer those saved details while no offering is live there:
 * it would send a patient to a location the provider no longer covers.
 *
 * Likewise a patient who chose a case type must only be offered the locations
 * where the provider treats that case type, not ones they cover only for
 * another.
 */

const towson = { provider_id: 'p1', location_id: 'towson', booking_link: 'https://book.example/towson', phone: '4105550100' }
const rosedale = { provider_id: 'p1', location_id: 'rosedale', booking_link: 'https://book.example/rosedale', phone: '4105550200' }
const otherProvider = { provider_id: 'p2', location_id: 'towson', booking_link: 'https://book.example/p2', phone: '4105550300' }

describe('liveProviderLocations', () => {
  const offerings = [
    { provider_id: 'p1', location_ids: ['towson'] },
    { provider_id: 'p2', location_ids: ['towson', 'rosedale'] },
  ]

  it('keeps a location the provider has an offering at', () => {
    expect(liveProviderLocations([towson, otherProvider], offerings, 'p1')).toEqual([towson])
  })

  it('drops a saved location with no offering behind it', () => {
    expect(liveProviderLocations([towson, rosedale], offerings, 'p1')).toEqual([towson])
  })

  it("does not count another provider's offering at that location", () => {
    expect(liveProviderLocations([rosedale], offerings, 'p1')).toEqual([])
  })

  it('offers only the locations where the provider treats the chosen case type', () => {
    const byCaseType = [
      { provider_id: 'p1', case_type_id: 'knee', location_ids: ['towson'] },
      { provider_id: 'p1', case_type_id: 'shoulder', location_ids: ['rosedale'] },
    ]
    expect(liveProviderLocations([towson, rosedale], byCaseType, 'p1', 'knee')).toEqual([towson])
    expect(liveProviderLocations([towson, rosedale], byCaseType, 'p1', 'shoulder')).toEqual([rosedale])
    expect(liveProviderLocations([towson, rosedale], byCaseType, 'p1', 'hip')).toEqual([])
  })

  it('offers every live location when no case type has been chosen', () => {
    const byCaseType = [
      { provider_id: 'p1', case_type_id: 'knee', location_ids: ['towson'] },
      { provider_id: 'p1', case_type_id: 'shoulder', location_ids: ['rosedale'] },
    ]
    expect(liveProviderLocations([towson, rosedale], byCaseType, 'p1', null)).toEqual([towson, rosedale])
  })

  it('copes with missing data', () => {
    expect(liveProviderLocations(undefined, undefined, 'p1')).toEqual([])
    expect(liveProviderLocations([towson], [{ provider_id: 'p1' }], 'p1')).toEqual([])
  })
})

type WidgetApi = {
  data: unknown
  state: Record<string, unknown>
  buildCard: (provider: Record<string, unknown>) => HTMLElement
}

async function boot(): Promise<WidgetApi> {
  vi.resetModules()
  delete (window as unknown as Record<string, unknown>).__pmWidgetBooted
  document.body.innerHTML = '<script data-widget-id="w1" src="https://widget.test/widget.js"></script>'
  vi.stubGlobal('SUPABASE_URL', 'https://unit.supabase.co')
  vi.stubGlobal('SUPABASE_ANON_KEY', 'anon')
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await import('../../widget/src/widget.js')
  return (window as unknown as { _ProviderRoute: WidgetApi })._ProviderRoute
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the provider card', () => {
  it('offers only the locations for the case type the patient chose', async () => {
    const api = await boot()
    api.data = {
      config: { default_booking_mode: 'advanced', default_phone_mode: 'advanced' },
      locations: [
        { id: 'towson', name: 'Towson' },
        { id: 'rosedale', name: 'Rosedale' },
      ],
      offerings: [
        { provider_id: 'p1', case_type_id: 'knee', location_ids: ['towson'] },
        { provider_id: 'p1', case_type_id: 'shoulder', location_ids: ['rosedale'] },
      ],
      providerLocations: [towson, rosedale],
    }
    api.state = { ...api.state, selectedLocationId: null, selectedCaseTypeId: 'knee' }

    const card = api.buildCard({ id: 'p1', name: 'Dr. Adams', booking_mode: 'default', phone_mode: 'default' })

    expect(card.innerHTML).toContain('https://book.example/towson')
    expect(card.innerHTML).not.toContain('https://book.example/rosedale')
    expect(card.innerHTML).not.toContain('4105550200')
  })

  it('offers booking and phone only where the provider has a live offering', async () => {
    const api = await boot()
    api.data = {
      config: { default_booking_mode: 'advanced', default_phone_mode: 'advanced' },
      locations: [
        { id: 'towson', name: 'Towson' },
        { id: 'rosedale', name: 'Rosedale' },
      ],
      offerings: [{ provider_id: 'p1', location_ids: ['towson'] }],
      providerLocations: [towson, rosedale],
    }
    api.state = { ...api.state, selectedLocationId: null }

    const card = api.buildCard({ id: 'p1', name: 'Dr. Adams', booking_mode: 'default', phone_mode: 'default' })

    expect(card.innerHTML).toContain('https://book.example/towson')
    expect(card.innerHTML).not.toContain('https://book.example/rosedale')
    expect(card.innerHTML).not.toContain('4105550200')
  })
})

describe('withSharedValues', () => {
  const rosedaleOther = { ...rosedale, booking_link: 'https://book.example/rosedale', phone: '4105550200' }
  const bare = { provider_id: 'p1', location_id: 'zzz', booking_link: null, phone: null }

  it('leaves each location its own link and phone in advanced mode', () => {
    const rows = [towson, rosedaleOther]
    expect(withSharedValues(rows, 'advanced', 'advanced')).toBe(rows)
  })

  it('offers the one shared link at every location in simple mode, even where rows disagree', () => {
    const [a, b] = withSharedValues([towson, rosedaleOther], 'simple', 'advanced')
    // Locations are taken in id order, so rosedale is first.
    expect(a.booking_link).toBe('https://book.example/rosedale')
    expect(b.booking_link).toBe('https://book.example/rosedale')
    // The phone column is advanced, so each keeps its own.
    expect([a.phone, b.phone]).toEqual(['4105550100', '4105550200'])
  })

  it('shares the phone the same way, independently of the link', () => {
    const [a, b] = withSharedValues([towson, rosedaleOther], 'advanced', 'simple')
    expect([a.phone, b.phone]).toEqual(['4105550200', '4105550200'])
    expect([a.booking_link, b.booking_link]).toEqual(['https://book.example/towson', 'https://book.example/rosedale'])
  })

  it('gives a location with nothing saved the shared link too', () => {
    const rows = withSharedValues([towson, bare], 'simple', 'simple')
    expect(rows.map((r) => r.booking_link)).toEqual(['https://book.example/towson', 'https://book.example/towson'])
    expect(rows.map((r) => r.phone)).toEqual(['4105550100', '4105550100'])
  })

  it('has no link at all when none is saved anywhere, rather than an empty string', () => {
    expect(withSharedValues([bare], 'simple', 'simple')[0]).toMatchObject({ booking_link: null, phone: null })
  })

  it('does not change the rows it is given', () => {
    const rows = [towson, rosedaleOther]
    withSharedValues(rows, 'simple', 'simple')
    expect(towson.booking_link).toBe('https://book.example/towson')
    expect(rows[1]).toBe(rosedaleOther)
  })
})
