import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The results screen opens with a card that says what the list is and plays the
 * patient's own answers back to them, so a filtered list is never mistaken for
 * "all our doctors". Driven through the real widget, from the first question to
 * the results.
 */

type WidgetApi = {
  shadow: ShadowRoot | null
  state: Record<string, unknown> & { answers: Record<string, unknown> }
  open: () => void
}

const payload = {
  config: { allowed_domains: ['localhost'], embed_mode: 'floating', primary_color: '#4F46E5', fallback_phone: '4105550100' },
  offerings: [
    { id: 'o1', provider_id: 'p1', case_type_id: 'elbow', location_ids: ['towson'], constraints: { min_age: 0, max_age: 99 } },
    { id: 'o2', provider_id: 'p2', case_type_id: 'elbow', location_ids: ['rosedale'], constraints: { min_age: 0, max_age: 99 } },
    { id: 'o3', provider_id: 'p3', case_type_id: 'elbow', location_ids: ['towson'], constraints: { min_age: 0, max_age: 99 } },
    { id: 'o4', provider_id: 'p4', case_type_id: 'knee', location_ids: ['rosedale'], constraints: { min_age: 0, max_age: 99 } },
  ],
  constraints: [
    { id: 'c-age', type: 'range', mapped_key: 'min_age', secondary_mapped_key: 'max_age' },
    { id: 'c-kid', type: 'binary', mapped_key: 'kid_ok', yes_label: 'Yes, treats children', no_label: 'Adults only' },
  ],
  questions: [
    { id: 'q-entry', question_type: 'entry', question_text: 'What hurts?', order_rank: 0, required: true },
    { id: 'q-provider', question_type: 'provider', question_text: 'Do you already know who you want to see?', order_rank: 1, required: true },
    { id: 'q-loc', question_type: 'location', question_text: 'Where?', order_rank: 2, required: true, system_config: {} },
    { id: 'q-age', question_type: 'clinical', constraint_id: 'c-age', question_text: 'How old are you?', order_rank: 3, required: true },
  ],
  caseTypes: [
    { id: 'elbow', name: 'Elbow', map_tag: null },
    { id: 'knee', name: 'Knee', map_tag: null },
  ],
  locations: [
    { id: 'towson', name: 'Towson' },
    { id: 'rosedale', name: 'Rosedale' },
  ],
  // p1-p3 treat elbow. p4 treats only knee, p5 has no live offering at all.
  providers: [1, 2, 3, 4, 5].map((n) => ({ id: `p${n}`, name: `Dr. ${n}`, category_ids: [], booking_mode: 'default', phone_mode: 'default' })),
  providerLocations: [{ provider_id: 'p4', location_id: 'rosedale', booking_link: null, self_schedule_link: null, phone: '4105550144' }],
  categories: [],
}

async function boot(): Promise<{ pm: WidgetApi; body: HTMLElement }> {
  vi.resetModules()
  delete (window as unknown as Record<string, unknown>).__pmWidgetBooted
  document.body.innerHTML = '<script data-widget-id="w1" src="https://widget.test/widget.js"></script>'
  vi.stubGlobal('SUPABASE_URL', 'https://unit.supabase.co')
  vi.stubGlobal('SUPABASE_ANON_KEY', 'anon')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })))
  await import('../../widget/src/widget.js')
  const pm = (window as unknown as { _ProviderRoute: WidgetApi })._ProviderRoute
  await vi.advanceTimersByTimeAsync(0)
  pm.open()
  return { pm, body: pm.shadow!.getElementById('pm-body') as HTMLElement }
}

const click = (el: Element | null) => (el as HTMLButtonElement).click()
const option = (body: HTMLElement, text: string) =>
  Array.from(body.querySelectorAll<HTMLButtonElement>('button.pm-option')).find((b) => b.textContent === text) ?? null

/** Pick the case type from the list, then answer the provider question. */
async function startAs(body: HTMLElement, knowsProvider: 'Yes' | 'No') {
  click(body.querySelector('button.pm-option'))
  await vi.advanceTimersByTimeAsync(400)
  click(option(body, knowsProvider))
  await vi.advanceTimersByTimeAsync(400)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the results recap card', () => {
  it('names the filter, counts the providers, and plays every answer back', async () => {
    const { body } = await boot()
    await startAs(body, 'No')

    const select = body.querySelector('select.pm-select') as HTMLSelectElement
    select.value = 'towson'
    click(body.querySelector('.pm-next-btn'))
    await vi.advanceTimersByTimeAsync(400)

    const input = body.querySelector('input.pm-number-input') as HTMLInputElement
    input.value = '45'
    click(body.querySelector('.pm-next-btn'))
    await vi.advanceTimersByTimeAsync(400)

    const card = body.querySelector('.pm-recap')!
    expect(card).not.toBeNull()
    expect(card.querySelector('.pm-recap-title')!.textContent).toBe('Elbow specialists · Towson')
    expect(card.querySelector('.pm-recap-count')!.textContent).toBe('3 providers')
    expect(card.querySelector('.pm-recap-note')!.textContent).toBe('Filtered by your answers — not everyone we have.')

    const rows = Array.from(body.querySelectorAll('.pm-answer-row')).map((r) => [
      r.querySelector('.pm-answer-q')!.textContent,
      r.querySelector('.pm-answer-a')!.textContent,
    ])
    expect(rows).toEqual([
      ['What hurts?', 'Elbow'],
      ['Do you already know who you want to see?', 'No'],
      ['Where?', 'Towson'],
      ['How old are you?', '45'],
    ])
  })

  it('says outright that "I know who I want" is a search of everyone', async () => {
    const { body } = await boot()
    await startAs(body, 'Yes')

    const card = body.querySelector('.pm-recap')!
    expect(card.querySelector('.pm-recap-eyebrow')!.textContent).toBe('All providers')
    expect(card.querySelector('.pm-recap-title')!.textContent).toBe('Search for your provider')
    expect(card.querySelector('.pm-recap-count')!.textContent).toBe('5 providers')
    expect(card.querySelector('.pm-recap-note')!.textContent).toBe(
      'Providers who treat elbow for your case come first. The rest are marked.'
    )
    expect(Array.from(body.querySelectorAll('.pm-answer-a')).map((a) => a.textContent)).toEqual(['Elbow', 'Yes'])
  })

  it('sticks to the top of the scrolling list, ahead of the provider cards', async () => {
    const { body } = await boot()
    await startAs(body, 'Yes')

    const results = body.querySelector('.pm-results')!
    const sticky = results.querySelector('.pm-recap-sticky')!
    expect(results.firstElementChild).toBe(sticky)
    expect(sticky.querySelector('.pm-recap')).not.toBeNull()
    // The sticky strip comes before the first provider card.
    const firstCard = results.querySelector('.pm-card')!
    expect(sticky.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says "1 provider", not "1 providers"', async () => {
    const offerings = payload.offerings.splice(1)
    const providers = payload.providers.splice(1)
    try {
      const { body } = await boot()
      await startAs(body, 'Yes')
      expect(body.querySelector('.pm-recap-count')!.textContent).toBe('1 provider')
    } finally {
      payload.offerings.push(...offerings)
      payload.providers.push(...providers)
    }
  })
})

describe('"I already know who I want to see"', () => {
  const names = (body: HTMLElement, selector: string) =>
    Array.from(body.querySelectorAll(selector)).map((c) => c.querySelector('.pm-name')!.textContent)

  it('lists the matched providers first, then everyone else, marked', async () => {
    const { body } = await boot()
    await startAs(body, 'Yes')

    const results = body.querySelector('.pm-results')!
    const plain = names(body, '.pm-card:not(.pm-card-outside)')
    expect(plain.sort()).toEqual(['Dr. 1', 'Dr. 2', 'Dr. 3'])
    // Alphabetical, after the matched ones.
    expect(names(body, '.pm-card-outside')).toEqual(['Dr. 4', 'Dr. 5'])
    const heading = results.querySelector('.pm-outside-section')!
    expect(heading.textContent).toContain('Other providers')
    expect(heading.textContent).toContain("These providers don't treat elbow for your case.")
    expect(heading.textContent).toContain('Call the office to confirm before booking.')
    // States what is true, not a guess at "may not match".
    expect(heading.textContent).not.toMatch(/may not|might/i)
    const badges = Array.from(body.querySelectorAll('.pm-card-outside .pm-outside-badge')).map((b) => b.textContent)
    expect(badges).toEqual(["⚠️ Doesn't treat Elbow", "⚠️ Doesn't treat Elbow"])

    const lastMatched = Array.from(results.querySelectorAll('.pm-card:not(.pm-card-outside)')).pop()!
    expect(lastMatched.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says "for your case" for a provider who treats the condition but was ruled out by an answer', async () => {
    // Ask the provider question last, after the age, and add an elbow provider who sees children only.
    const providerQuestion = payload.questions.find((q) => q.id === 'q-provider')!
    providerQuestion.order_rank = 9
    payload.providers.push({ id: 'p6', name: 'Dr. 6', category_ids: [], booking_mode: 'default', phone_mode: 'default' })
    payload.offerings.push({ id: 'o6', provider_id: 'p6', case_type_id: 'elbow', location_ids: ['towson'], constraints: { min_age: 0, max_age: 12 } })
    try {
      const { body } = await boot()
      click(body.querySelector('button.pm-option'))
      await vi.advanceTimersByTimeAsync(400)
      ;(body.querySelector('select.pm-select') as HTMLSelectElement).value = 'towson'
      click(body.querySelector('.pm-next-btn'))
      await vi.advanceTimersByTimeAsync(400)
      ;(body.querySelector('input.pm-number-input') as HTMLInputElement).value = '45'
      click(body.querySelector('.pm-next-btn'))
      await vi.advanceTimersByTimeAsync(400)
      click(option(body, 'Yes'))
      await vi.advanceTimersByTimeAsync(400)

      const badgeFor = (name: string) =>
        Array.from(body.querySelectorAll('.pm-card-outside')).find((c) => c.querySelector('.pm-name')!.textContent === name)!.querySelector('.pm-outside-badge')!
          .textContent
      expect(badgeFor('Dr. 6')).toBe("⚠️ Doesn't treat Elbow for your case")
      expect(badgeFor('Dr. 4')).toBe("⚠️ Doesn't treat Elbow")
    } finally {
      providerQuestion.order_rank = 1
      payload.providers.pop()
      payload.offerings.pop()
    }
  })

  it('gives a marked provider their own contact details, or the main office when they have none', async () => {
    const { body } = await boot()
    await startAs(body, 'Yes')

    const [knee, none] = Array.from(body.querySelectorAll('.pm-card-outside'))
    // p4 treats knee, not elbow: still reachable at the number saved for where they practise.
    expect(knee.querySelector('a.pm-call')!.getAttribute('href')).toBe('tel:4105550144')
    // p5 has nothing of their own, so the office number stands in.
    expect(none.querySelector('a.pm-call')!.getAttribute('href')).toBe('tel:4105550100')
  })

  it('searches the whole list, hiding the "not matched" heading when none of it is left', async () => {
    const { body } = await boot()
    await startAs(body, 'Yes')
    const search = body.querySelector('input.pm-search') as HTMLInputElement
    const heading = body.querySelector('.pm-outside-section') as HTMLElement
    const visible = () =>
      Array.from(body.querySelectorAll<HTMLElement>('.pm-card'))
        .filter((c) => c.style.display !== 'none')
        .map((c) => c.querySelector('.pm-name')!.textContent)
    const type = (value: string) => {
      search.value = value
      search.dispatchEvent(new Event('input'))
    }

    type('dr. 5')
    expect(visible()).toEqual(['Dr. 5'])
    expect(heading.style.display).toBe('')

    type('dr. 1')
    expect(visible()).toEqual(['Dr. 1'])
    expect(heading.style.display).toBe('none')

    type('nobody')
    expect(visible()).toEqual([])
    expect(body.textContent).toContain('No provider by that name')

    type('')
    expect(visible()).toHaveLength(5)
    expect(heading.style.display).toBe('')
  })

  it('leaves "Help me choose instead" to finish the questions and show only the filtered list', async () => {
    const { pm, body } = await boot()
    await startAs(body, 'Yes')
    expect(body.querySelector('.pm-card-outside')).not.toBeNull()

    click(body.querySelector('.pm-help'))
    await vi.advanceTimersByTimeAsync(400)
    ;(body.querySelector('select.pm-select') as HTMLSelectElement).value = 'towson'
    click(body.querySelector('.pm-next-btn'))
    await vi.advanceTimersByTimeAsync(400)
    ;(body.querySelector('input.pm-number-input') as HTMLInputElement).value = '45'
    click(body.querySelector('.pm-next-btn'))
    await vi.advanceTimersByTimeAsync(400)

    const results = body.querySelector('.pm-results')!
    expect(pm.state.bypassMode).toBe(false)
    expect(results.querySelector('.pm-recap-title')!.textContent).toBe('Elbow specialists · Towson')
    // The knee-only and no-offering providers are gone, and so is the search.
    expect(results.textContent).not.toContain("Doesn't treat")
    expect(Array.from(results.querySelectorAll('.pm-name')).map((n) => n.textContent).sort()).toEqual(['Dr. 1', 'Dr. 2', 'Dr. 3'])
    expect(results.querySelector('input.pm-search')).toBeNull()
  })
})

describe('getAnswerRows', () => {
  it('uses the admin\'s own yes/no wording, and shows a skipped question as skipped', async () => {
    const { pm } = await boot()
    const widget = pm as unknown as {
      data: typeof payload
      getAnswerRows: () => Array<{ question: string; answer: string }>
    }
    widget.data = {
      ...payload,
      questions: [
        ...payload.questions,
        { id: 'q-kid', question_type: 'clinical', constraint_id: 'c-kid', question_text: 'Is the patient a child?', order_rank: 4, required: true },
        { id: 'q-opt', question_type: 'clinical', constraint_id: 'c-age', question_text: 'Anything else?', order_rank: 5, required: false },
      ],
    }
    pm.state.answers = { 'q-entry': 'elbow', 'q-loc': null, 'q-kid': 'yes', 'q-opt': null }
    expect(widget.getAnswerRows()).toEqual([
      { question: 'What hurts?', answer: 'Elbow' },
      { question: 'Where?', answer: 'No preference' },
      { question: 'Is the patient a child?', answer: 'Yes, treats children' },
      { question: 'Anything else?', answer: 'Skipped' },
    ])
  })
})
