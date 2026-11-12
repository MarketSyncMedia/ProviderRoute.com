import { describe, expect, it } from 'vitest'
import {
  BOOKING_WORDS,
  SELF_SCHEDULE_WORDS,
  linkButtonLabel,
  linkSlideHeader,
  planLinkAction,
} from '../../widget/src/linkAction.js'
import { withSharedValues } from '../../widget/src/providerLocations.js'

/**
 * A result card has two link buttons -- an appointment request and
 * self-scheduling -- each following its own simple / advanced mode, and each
 * present only where the provider has that link. The admin writes the text on
 * each; blank means the built-in wording.
 */

const row = (location_id: string, booking_link: string | null, self_schedule_link: string | null = null) => ({
  provider_id: 'p1',
  location_id,
  booking_link,
  self_schedule_link,
  phone: null,
})

const towson = row('towson', 'https://book.example/towson', 'https://cal.example/towson')
const rosedale = row('rosedale', 'https://book.example/rosedale', 'https://cal.example/rosedale')

describe('planLinkAction', () => {
  it('offers nothing for a kind of link the provider does not have', () => {
    const none = [row('towson', 'https://book.example/towson'), row('rosedale', 'https://book.example/rosedale')]
    expect(planLinkAction(none, 'self_schedule_link', 'simple', null)).toEqual({ type: 'none' })
    expect(planLinkAction(none, 'self_schedule_link', 'advanced', 'towson')).toEqual({ type: 'none' })
    expect(planLinkAction([], 'booking_link', 'simple', null)).toEqual({ type: 'none' })
  })

  it('offers the chosen location\'s link when the patient picked one', () => {
    expect(planLinkAction([towson, rosedale], 'self_schedule_link', 'advanced', 'rosedale')).toEqual({
      type: 'link',
      locationId: 'rosedale',
      url: 'https://cal.example/rosedale',
      atLocation: true,
    })
  })

  it('offers the only link directly, naming its location', () => {
    expect(planLinkAction([towson, row('rosedale', null, null)], 'booking_link', 'advanced', null)).toEqual({
      type: 'link',
      locationId: 'towson',
      url: 'https://book.example/towson',
      atLocation: true,
    })
  })

  it('offers the one shared link directly in simple mode, without naming a location', () => {
    const shared = withSharedValues([towson, rosedale], 'simple', 'advanced', 'simple')
    const action = planLinkAction(shared, 'self_schedule_link', 'simple', null)
    expect(action).toMatchObject({ type: 'link', url: 'https://cal.example/rosedale', atLocation: false })
  })

  it('lets the patient choose a location in advanced mode with several links', () => {
    expect(planLinkAction([towson, rosedale], 'booking_link', 'advanced', null)).toEqual({
      type: 'choose',
      options: [
        { locationId: 'towson', url: 'https://book.example/towson' },
        { locationId: 'rosedale', url: 'https://book.example/rosedale' },
      ],
    })
  })

  it('falls back to choosing when the picked location has no link of that kind', () => {
    const rows = [row('towson', 'https://book.example/towson', null), row('rosedale', 'https://book.example/rosedale', 'https://cal.example/rosedale'), row('lutherville', null, 'https://cal.example/luth')]
    expect(planLinkAction(rows, 'self_schedule_link', 'advanced', 'towson').type).toBe('choose')
  })

  it('keeps the two kinds independent: one can be a list while the other is a single button', () => {
    const rows = [towson, rosedale]
    expect(planLinkAction(rows, 'booking_link', 'advanced', null).type).toBe('choose')
    const selfOnly = withSharedValues(rows, 'advanced', 'advanced', 'simple')
    expect(planLinkAction(selfOnly, 'self_schedule_link', 'simple', null).type).toBe('link')
  })
})

describe('withSharedValues with a self-scheduling mode', () => {
  it('shares the self-scheduling link independently of the others', () => {
    const [a, b] = withSharedValues([towson, rosedale], 'advanced', 'advanced', 'simple')
    expect([a.self_schedule_link, b.self_schedule_link]).toEqual(['https://cal.example/rosedale', 'https://cal.example/rosedale'])
    expect([a.booking_link, b.booking_link]).toEqual(['https://book.example/towson', 'https://book.example/rosedale'])
  })

  it('leaves the rows alone when no mode is simple', () => {
    const rows = [towson, rosedale]
    expect(withSharedValues(rows, 'advanced', 'advanced', 'advanced')).toBe(rows)
    expect(withSharedValues(rows, 'advanced', 'advanced')).toBe(rows)
  })

  it('gives a location with no self-scheduling link the shared one, so it shows the button there too', () => {
    const shared = withSharedValues([row('a', 'https://book.example/a', 'https://cal.example/dr'), row('b', 'https://book.example/b', null)], 'advanced', 'advanced', 'simple')
    expect(shared.map((r) => r.self_schedule_link)).toEqual(['https://cal.example/dr', 'https://cal.example/dr'])
  })

  it('has no self-scheduling link at all when none is saved anywhere', () => {
    const shared = withSharedValues([row('a', 'https://book.example/a'), row('b', null)], 'simple', 'simple', 'simple')
    expect(shared.every((r) => r.self_schedule_link === null)).toBe(true)
  })
})

describe('linkButtonLabel', () => {
  it('uses the admin\'s wording exactly as written, whatever the location', () => {
    expect(linkButtonLabel('Request an Appt', BOOKING_WORDS, true, 'Towson')).toBe('Request an Appt')
    expect(linkButtonLabel('  Pick a time  ', SELF_SCHEDULE_WORDS, false)).toBe('Pick a time')
  })

  it('keeps the built-in booking wording when none is set, naming the location when it is one', () => {
    expect(linkButtonLabel(null, BOOKING_WORDS, true, 'Towson')).toBe('Book at Towson')
    expect(linkButtonLabel('', BOOKING_WORDS, true)).toBe('Book at Location')
    expect(linkButtonLabel(undefined, BOOKING_WORDS, false)).toBe('Book Now')
  })

  it('has built-in self-scheduling wording of its own', () => {
    expect(linkButtonLabel(null, SELF_SCHEDULE_WORDS, true, 'Towson')).toBe('Schedule at Towson')
    expect(linkButtonLabel(null, SELF_SCHEDULE_WORDS, false)).toBe('Schedule Online')
  })
})

describe('linkSlideHeader', () => {
  it('is the admin\'s wording, or the built-in header', () => {
    expect(linkSlideHeader('Request an Appt', BOOKING_WORDS)).toBe('Request an Appt')
    expect(linkSlideHeader('', BOOKING_WORDS)).toBe('Book at...')
    expect(linkSlideHeader(null, SELF_SCHEDULE_WORDS)).toBe('Schedule at...')
  })
})
