import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The result card's link buttons, rendered by the real widget: an appointment
 * request button and a self-scheduling button, each following its own simple /
 * advanced mode, the second present only for a provider who has a link for it,
 * and each saying whatever the admin wrote for it.
 */

type Card = HTMLElement
type WidgetApi = {
  data: unknown
  state: Record<string, unknown>
  buildCard: (provider: unknown) => Card | null
}

const LOCATIONS = [
  { id: 'towson', name: 'Towson' },
  { id: 'rosedale', name: 'Rosedale' },
]

const row = (location_id: string, booking_link: string | null, self_schedule_link: string | null, phone: string | null = null) => ({
  provider_id: 'p1',
  location_id,
  booking_link,
  self_schedule_link,
  phone,
})

let widget: WidgetApi

async function boot() {
  vi.resetModules()
  delete (window as unknown as Record<string, unknown>).__pmWidgetBooted
  document.body.innerHTML = '<script data-widget-id="w1" src="https://widget.test/widget.js"></script>'
  vi.stubGlobal('SUPABASE_URL', 'https://unit.supabase.co')
  vi.stubGlobal('SUPABASE_ANON_KEY', 'anon')
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  await import('../../widget/src/widget.js')
  widget = (window as unknown as { _ProviderRoute: WidgetApi })._ProviderRoute
}

function render({
  config = {},
  provider = {},
  rows = [row('towson', 'https://book.example/dr', 'https://cal.example/dr'), row('rosedale', 'https://book.example/dr', 'https://cal.example/dr')],
  selectedLocationId = null,
}: {
  config?: Record<string, unknown>
  provider?: Record<string, unknown>
  rows?: ReturnType<typeof row>[]
  selectedLocationId?: string | null
} = {}) {
  widget.data = {
    config: { default_booking_mode: 'simple', default_phone_mode: 'simple', default_self_schedule_mode: 'simple', ...config },
    providers: [],
    providerLocations: rows,
    offerings: [{ provider_id: 'p1', case_type_id: 'ct1', location_ids: ['towson', 'rosedale'] }],
    locations: LOCATIONS,
    categories: [],
  }
  widget.state = { selectedLocationId, selectedCaseTypeId: null, resultsPositions: [] }
  const card = widget.buildCard({
    id: 'p1',
    name: 'Dr. Smith',
    booking_mode: 'default',
    phone_mode: 'default',
    self_schedule_mode: 'default',
    category_ids: [],
    ...provider,
  })
  expect(card).not.toBeNull()
  return card as Card
}

/** Every link button on the card, as [text, href]. */
const links = (card: Card) =>
  Array.from(card.querySelectorAll<HTMLAnchorElement>('a.pm-book')).map((a) => [a.textContent, a.getAttribute('href')])
const triggers = (card: Card) => Array.from(card.querySelectorAll<HTMLButtonElement>('button.pm-book'))

beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await boot()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the result card\'s appointment request and self-scheduling buttons', () => {
  it('shows both buttons, with the admin\'s own wording, in simple mode', () => {
    const card = render({ config: { booking_button_text: 'Request an Appt', self_schedule_button_text: 'Pick a Time' } })
    expect(links(card)).toEqual([
      ['Request an Appt', 'https://book.example/dr'],
      ['Pick a Time', 'https://cal.example/dr'],
    ])
  })

  it('uses the built-in wording where the admin wrote none', () => {
    const card = render()
    expect(links(card)).toEqual([
      ['Book Now', 'https://book.example/dr'],
      ['Schedule Online', 'https://cal.example/dr'],
    ])
  })

  it('shows no self-scheduling button for a provider with no self-scheduling link', () => {
    const card = render({
      rows: [row('towson', 'https://book.example/dr', null), row('rosedale', 'https://book.example/dr', null)],
      config: { self_schedule_button_text: 'Pick a Time' },
    })
    expect(links(card)).toEqual([['Book Now', 'https://book.example/dr']])
    expect(card.textContent).not.toContain('Pick a Time')
  })

  it('shows only self-scheduling for a provider with no appointment request link', () => {
    const card = render({ rows: [row('towson', null, 'https://cal.example/dr'), row('rosedale', null, 'https://cal.example/dr')] })
    expect(links(card)).toEqual([['Schedule Online', 'https://cal.example/dr']])
  })

  it('names the location the patient chose, unless the admin wrote their own wording', () => {
    const chosen = render({ selectedLocationId: 'towson' })
    expect(links(chosen).map((l) => l[0])).toEqual(['Book at Towson', 'Schedule at Towson'])

    const custom = render({ selectedLocationId: 'towson', config: { booking_button_text: 'Request an Appt' } })
    expect(links(custom).map((l) => l[0])).toEqual(['Request an Appt', 'Schedule at Towson'])
  })

  it('follows each link\'s own mode: advanced self-scheduling lets the patient choose a location', () => {
    const card = render({
      config: { default_self_schedule_mode: 'advanced', self_schedule_button_text: 'Pick a Time' },
      rows: [row('towson', 'https://book.example/dr', 'https://cal.example/towson'), row('rosedale', 'https://book.example/dr', 'https://cal.example/rosedale')],
    })
    // The request link is one button; self-scheduling is a button that opens a list.
    expect(links(card).filter((l) => l[1] === 'https://book.example/dr')).toEqual([['Book Now', 'https://book.example/dr']])
    const trigger = triggers(card).find((b) => b.textContent === 'Pick a Time')
    expect(trigger).toBeDefined()
    // The locations sit in a list the button opens, under the same wording.
    const choices = links(card).filter((l) => String(l[1]).startsWith('https://cal.example/'))
    expect(choices).toEqual([
      ['Towson', 'https://cal.example/towson'],
      ['Rosedale', 'https://cal.example/rosedale'],
    ])
    expect(card.textContent).toContain('Pick a Time')
  })

  it('opens the list of locations from the button, and goes back', () => {
    const card = render({
      config: { default_booking_mode: 'advanced' },
      rows: [row('towson', 'https://book.example/towson', null), row('rosedale', 'https://book.example/rosedale', null)],
    })
    const trigger = triggers(card).find((b) => b.textContent === 'Book Now')!
    const slide = Array.from(card.querySelectorAll<HTMLElement>('div')).find((d) => d.textContent?.startsWith('Book at...'))!
    expect(slide.style.display).toBe('none')

    trigger.click()
    expect(slide.style.display).toBe('flex')
    slide.querySelector<HTMLButtonElement>('button.pm-back-link')!.click()
    expect(slide.style.display).toBe('none')
  })

  it('follows a provider\'s own mode over the account default, and is shared across rows that disagree in simple mode', () => {
    const card = render({
      provider: { self_schedule_mode: 'simple' },
      config: { default_self_schedule_mode: 'advanced' },
      rows: [row('towson', 'https://book.example/dr', 'https://cal.example/towson'), row('rosedale', 'https://book.example/dr', 'https://cal.example/rosedale')],
    })
    // Locations are taken in id order, so rosedale's link stands for both.
    expect(links(card).filter((l) => String(l[1]).startsWith('https://cal.example/'))).toEqual([
      ['Schedule Online', 'https://cal.example/rosedale'],
    ])
  })

  it('is unchanged for a widget served by data that predates self-scheduling', () => {
    // No self-scheduling fields or settings at all, as before the feature.
    const card = render({
      config: { default_self_schedule_mode: undefined },
      provider: { self_schedule_mode: undefined },
      rows: [
        { provider_id: 'p1', location_id: 'towson', booking_link: 'https://book.example/dr', phone: null },
        { provider_id: 'p1', location_id: 'rosedale', booking_link: 'https://book.example/dr', phone: null },
      ] as never,
    })
    expect(links(card)).toEqual([['Book Now', 'https://book.example/dr']])
  })

  it('still shows the phone button beside them', () => {
    const card = render({
      rows: [row('towson', 'https://book.example/dr', 'https://cal.example/dr', '4105550100'), row('rosedale', 'https://book.example/dr', 'https://cal.example/dr', '4105550100')],
    })
    expect(card.querySelectorAll('a.pm-call')).toHaveLength(1)
    expect(links(card)).toHaveLength(2)
  })
})
