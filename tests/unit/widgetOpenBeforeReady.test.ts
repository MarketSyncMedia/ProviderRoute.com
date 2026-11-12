import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * window._ProviderRoute.open() is what host-page triggers ("Find a Specialist")
 * call. A click that lands while the widget's config is still downloading used
 * to be reported by host pages as "domain not allowed" (data is null while the
 * fetch is in flight, same as when the domain is blocked) and was then lost.
 * It must instead open as soon as the config arrives, ignoring the optional
 * delay that only governs the floating button.
 */

type WidgetApi = {
  loadState: string
  unavailableReason: string | null
  open: () => void
  shadow: ShadowRoot | null
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      allowed_domains: ['localhost'],
      embed_mode: 'floating',
      open_delay_enabled: true,
      open_delay_seconds: 60,
      primary_color: '#4F46E5',
      ...overrides,
    },
    offerings: [],
    questions: [],
    case_types: [],
    locations: [],
    providers: [],
  }
}

let resolveFetch: (res: { ok: boolean; status?: number; json: () => Promise<unknown> }) => void

async function boot(): Promise<WidgetApi> {
  vi.resetModules()
  delete (window as unknown as Record<string, unknown>).__pmWidgetBooted
  document.body.innerHTML = '<script data-widget-id="w1" src="https://widget.test/widget.js"></script>'
  vi.stubGlobal('SUPABASE_URL', 'https://unit.supabase.co')
  vi.stubGlobal('SUPABASE_ANON_KEY', 'anon')
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve as typeof resolveFetch
        }),
    ),
  )
  await import('../../widget/src/widget.js')
  return (window as unknown as { _ProviderRoute: WidgetApi })._ProviderRoute
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

describe('widget open() before the config has loaded', () => {
  it('reports loading, not unavailable, while the fetch is in flight', async () => {
    const pm = await boot()
    expect(pm.loadState).toBe('loading')
  })

  it('opens the chat as soon as the config lands, without waiting out the open delay', async () => {
    const pm = await boot()
    pm.open() // clicked early, config still loading
    expect(pm.shadow).toBeNull()

    resolveFetch({ ok: true, json: async () => payload() })
    await vi.advanceTimersByTimeAsync(0)

    expect(pm.loadState).toBe('ready')
    expect(pm.shadow?.getElementById('pm-chat')).not.toBeNull()
    // The delayed floating button must not pop in on top of the open chat.
    vi.advanceTimersByTime(61_000)
    expect(pm.shadow?.querySelector('.pm-btn')).toBeNull()
  })

  it('drops the queued open and reports why when the domain is not allowed', async () => {
    const pm = await boot()
    pm.open()
    resolveFetch({ ok: true, json: async () => payload({ allowed_domains: ['other.example'] }) })
    await vi.advanceTimersByTimeAsync(0)

    expect(pm.loadState).toBe('unavailable')
    expect(pm.unavailableReason).toBe('domain')
    expect(document.getElementById('pm-widget-host')).toBeNull()
  })

  it('reports a load failure separately from a blocked domain', async () => {
    const pm = await boot()
    resolveFetch({ ok: false, status: 500, json: async () => ({}) })
    await vi.advanceTimersByTimeAsync(0)

    expect(pm.loadState).toBe('unavailable')
    expect(pm.unavailableReason).toBe('load')
  })

  it('still opens immediately when called after the config has loaded', async () => {
    const pm = await boot()
    resolveFetch({ ok: true, json: async () => payload() })
    await vi.advanceTimersByTimeAsync(0)
    expect(pm.shadow?.getElementById('pm-chat')).toBeNull()

    pm.open()
    expect(pm.shadow?.getElementById('pm-chat')).not.toBeNull()
  })
})
