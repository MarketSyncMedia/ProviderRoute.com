import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Enter does what Next does. The widget's question fields sit in plain
 * containers rather than a <form>, so the browser does nothing with Enter on
 * its own; without this a patient has to reach for the Next button.
 *
 * Also: the diagram/list choice on the case type question survives the map
 * being redrawn (the Back button redraws it).
 */

type WidgetApi = {
  shadow: ShadowRoot | null
  state: Record<string, unknown> & { answers: Record<string, unknown>; caseTypeListView?: boolean }
  open: () => void
  data: { questions: Array<Record<string, unknown>> }
  renderCaseTypes: (q: Record<string, unknown>) => void
}

const payload = {
  config: { allowed_domains: ['localhost'], embed_mode: 'floating', primary_color: '#4F46E5' },
  offerings: [{ id: 'o1', provider_id: 'p1', case_type_id: 'knee', location_ids: ['towson'], min_age: 0, max_age: 99 }],
  questions: [
    { id: 'q-loc', question_type: 'location', question_text: 'Where?', order_rank: 1, required: true, system_config: {} },
    { id: 'q-entry', question_type: 'entry', question_text: 'What hurts?', order_rank: 0, required: true },
  ],
  caseTypes: [
    { id: 'knee', name: 'Knee', map_tag: 'knee' },
    { id: 'general', name: 'General', map_tag: null },
  ],
  locations: [{ id: 'towson', name: 'Towson' }],
  providers: [],
}

async function boot(): Promise<WidgetApi> {
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
  return pm
}

const enter = (target: Element) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Enter in a question field', () => {
  it('presses Next on the location question', async () => {
    const pm = await boot()
    const body = pm.shadow!.getElementById('pm-body')!
    // The first question is the case type map; skip past it.
    ;(body.querySelector('.pm-bodymap-toggle') as HTMLButtonElement).click()
    ;(body.querySelector('.pm-bodymap-list button') as HTMLButtonElement).click()
    await vi.advanceTimersByTimeAsync(400)

    const select = body.querySelector('select.pm-select') as HTMLSelectElement
    expect(select).not.toBeNull()

    // Nothing chosen yet: Enter is Next, and Next does nothing without an answer.
    enter(select)
    expect(pm.state.answers['q-loc']).toBeUndefined()

    select.value = 'towson'
    enter(select)
    expect(pm.state.answers['q-loc']).toBe('towson')
  })
})

describe('diagram or list on the case type question', () => {
  it('remembers the choice when the map is redrawn', async () => {
    const pm = await boot()
    const body = pm.shadow!.getElementById('pm-body')!
    const stage = () => body.querySelector('.pm-bodymap-stage') as HTMLElement
    expect(stage().hidden).toBe(false)

    ;(body.querySelector('.pm-bodymap-toggle') as HTMLButtonElement).click()
    expect(pm.state.caseTypeListView).toBe(true)

    body.innerHTML = ''
    pm.renderCaseTypes(pm.data.questions.find((q) => q.question_type === 'entry')!)
    expect(stage().hidden).toBe(true)
    expect((body.querySelector('.pm-bodymap-toggle') as HTMLElement).textContent).toBe('Switch to diagram view')

    // And back again.
    ;(body.querySelector('.pm-bodymap-toggle') as HTMLButtonElement).click()
    expect(pm.state.caseTypeListView).toBe(false)
  })
})
