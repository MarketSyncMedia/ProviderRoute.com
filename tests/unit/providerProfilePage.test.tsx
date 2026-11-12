import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Provider, ProviderLocation } from '../../src/types/database'

/**
 * Regression test for a real production crash (React error #301, "Too many
 * re-renders"): `providerLocations` used to default to a fresh `[]` literal
 * every render while its query was still loading. The render-time sync block
 * beneath it compared that by reference, so once any *other* query on this
 * page settled first and triggered a re-render — near-guaranteed, since the
 * page fires 7+ queries — the newly allocated `[]` never matched the last
 * one, looping until React threw. It shipped unnoticed for a while because
 * nothing here rendered the actual page; see ProviderProfilePage.tsx around
 * `providerLocationsData` for the fix.
 *
 * This test reproduces the exact trigger: hold provider-locations back so
 * other queries resolve (and re-render the page) first.
 */

const providersApi = vi.hoisted(() => ({
  getProvider: vi.fn(),
  updateProvider: vi.fn(),
  archiveProvider: vi.fn(),
  uploadProviderImage: vi.fn(),
  removeProviderImage: vi.fn(),
}))
vi.mock('../../src/lib/api/providers', () => providersApi)

const providerLocationsApi = vi.hoisted(() => ({
  getProviderLocations: vi.fn(),
  upsertProviderLocation: vi.fn(),
}))
vi.mock('../../src/lib/api/providerLocations', () => providerLocationsApi)

const offeringsApi = vi.hoisted(() => ({
  getOfferingsByProvider: vi.fn(),
  getArchivedOfferingsByProvider: vi.fn(),
  createOffering: vi.fn(),
  updateOffering: vi.fn(),
  archiveOffering: vi.fn(),
  restoreOffering: vi.fn(),
}))
vi.mock('../../src/lib/api/offerings', () => offeringsApi)

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('../../src/components/ui/toastStore', () => ({ useToast: () => ({ toast }) }))

// Minimal chainable stand-in for the supabase-js query builder: every method
// returns itself, and it resolves like a promise when awaited — matching
// how ProviderProfilePage queries categories/locations/case types/constraints
// directly rather than through a lib/api wrapper.
function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = chain
  builder.eq = chain
  builder.order = chain
  builder.in = chain
  builder.then = (
    onfulfilled?: ((v: typeof result) => unknown) | null,
    onrejected?: ((e: unknown) => unknown) | null,
  ) => Promise.resolve(result).then(onfulfilled, onrejected)
  return builder
}

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) =>
      makeQueryBuilder({
        data:
          table === 'constraints'
            ? [{ id: 'c1', name: 'Accepts Medicare', type: 'binary', mapped_key: 'medicare', sort_order: 0 }]
            : table === 'locations'
              ? [
                  { id: 'l1', name: 'Towson', sort_order: 0 },
                  { id: 'l2', name: 'Rosedale', sort_order: 1 },
                ]
              : [],
        error: null,
      }),
    ),
  },
}))

import ProviderProfilePage from '../../src/pages/providers/ProviderProfilePage'
import { useAuthStore } from '../../src/stores/authStore'

function makeProvider(over: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    org_id: 'org1',
    name: 'Dr. Jane Smith',
    normalized_name: 'jane smith',
    npi: null,
    email: null,
    subtitle: null,
    bio_link: null,
    image_url: null,
    category_ids: [],
    booking_mode: 'default',
    phone_mode: 'default',
    is_archived: false,
    created_at: '',
    updated_at: '',
    ...over,
  }
}

let client: QueryClient

function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/providers/p1']}>
        <Routes>
          <Route path="/providers/:id" element={<ProviderProfilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ProviderProfilePage render stability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      org: { id: 'org1', name: 'Test Org' } as never,
      user: { id: 'u1', org_id: 'org1', name: 'Tester', email: 't@example.com' } as never,
    })
    providersApi.getProvider.mockResolvedValue(makeProvider())
    offeringsApi.getOfferingsByProvider.mockResolvedValue([])
    offeringsApi.getArchivedOfferingsByProvider.mockResolvedValue([])
    providerLocationsApi.getProviderLocations.mockResolvedValue([])
  })

  it('does not infinite-loop when provider-locations resolves after the other queries', async () => {
    let resolveLocations: (v: ProviderLocation[]) => void = () => {}
    providerLocationsApi.getProviderLocations.mockReturnValue(
      new Promise<ProviderLocation[]>((resolve) => {
        resolveLocations = resolve
      }),
    )

    renderPage()

    // Every other query (provider, offerings, categories, org locations,
    // case types, constraints) resolves immediately and re-renders the page
    // while provider-locations is still pending — the exact trigger.
    await screen.findByText(/Dr\. Jane Smith/)

    resolveLocations([])

    await waitFor(() => {
      expect(screen.getByText(/Dr\. Jane Smith/)).toBeInTheDocument()
    })
  })
})

describe('ProviderProfilePage offerings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      org: { id: 'org1', name: 'Test Org' } as never,
      user: { id: 'u1', org_id: 'org1', name: 'Tester', email: 't@example.com' } as never,
    })
    providersApi.getProvider.mockResolvedValue(makeProvider())
    providerLocationsApi.getProviderLocations.mockResolvedValue([])
    offeringsApi.getArchivedOfferingsByProvider.mockResolvedValue([])
    offeringsApi.getOfferingsByProvider.mockResolvedValue([
      {
        id: 'o1',
        provider_id: 'p1',
        org_id: 'org1',
        case_type_id: 'ct1',
        location_ids: [],
        constraints: { medicare: 1 },
        is_archived: false,
      },
    ])
  })

  it('names constraints as the admin named them, not by their stored keys', async () => {
    renderPage()

    expect(await screen.findByText('Accepts Medicare')).toBeInTheDocument()
    expect(screen.queryByText(/medicare: 1/)).not.toBeInTheDocument()
  })

  it('manages booking details only at live locations, not archived ones the offering still lists', async () => {
    offeringsApi.getOfferingsByProvider.mockResolvedValue([
      {
        id: 'o1',
        provider_id: 'p1',
        org_id: 'org1',
        case_type_id: 'ct1',
        location_ids: ['l1', 'l-archived'],
        constraints: {},
        is_archived: false,
      },
    ])
    providerLocationsApi.getProviderLocations.mockResolvedValue([
      { provider_id: 'p1', location_id: 'l1', booking_link: 'https://book.example/towson', phone: null },
      { provider_id: 'p1', location_id: 'l-archived', booking_link: 'https://book.example/old', phone: null },
    ])
    renderPage()

    expect(await screen.findByDisplayValue('https://book.example/towson')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('https://book.example/old')).not.toBeInTheDocument()
  })

  it('archives an offering under that name and reports a failure', async () => {
    offeringsApi.archiveOffering.mockResolvedValue({ error: 'network down' })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Archive offering' }))
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(offeringsApi.archiveOffering).toHaveBeenCalledWith('o1'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('network down'))
  })
})

describe('ProviderProfilePage archived offerings', () => {
  const archivedOffering = {
    id: 'o9',
    provider_id: 'p1',
    org_id: 'org1',
    case_type_id: 'ct-unknown',
    location_ids: [],
    constraints: { medicare: 1 },
    is_archived: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      org: { id: 'org1', name: 'Test Org' } as never,
      user: { id: 'u1', org_id: 'org1', name: 'Tester', email: 't@example.com' } as never,
    })
    providersApi.getProvider.mockResolvedValue(makeProvider())
    providerLocationsApi.getProviderLocations.mockResolvedValue([])
    offeringsApi.getOfferingsByProvider.mockResolvedValue([])
    offeringsApi.getArchivedOfferingsByProvider.mockResolvedValue([archivedOffering])
    offeringsApi.restoreOffering.mockResolvedValue({ error: null })
  })

  it('shows a collapsed section with the archived count, and expands to list them', async () => {
    renderPage()

    const header = await screen.findByRole('button', { name: /Archived offerings/ })
    await waitFor(() => expect(header).toHaveTextContent('1'))
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument()

    await userEvent.click(header)

    expect(header).toHaveAttribute('aria-expanded', 'true')
    // The constraint's name, not its stored key and value.
    expect(await screen.findByText('Accepts Medicare')).toBeInTheDocument()
    expect(screen.queryByText(/medicare: 1/)).not.toBeInTheDocument()
    expect(offeringsApi.getArchivedOfferingsByProvider).toHaveBeenCalledWith('p1')
  })

  it('restores an archived offering and refetches both offering lists', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Archived offerings/ }))
    offeringsApi.getArchivedOfferingsByProvider.mockResolvedValue([])
    const activeFetchesBefore = offeringsApi.getOfferingsByProvider.mock.calls.length

    await userEvent.click(await screen.findByRole('button', { name: /restore/i }))

    await waitFor(() => expect(offeringsApi.restoreOffering).toHaveBeenCalledWith('o9'))
    await waitFor(() => expect(screen.getByText('No archived offerings')).toBeInTheDocument())
    expect(offeringsApi.getOfferingsByProvider.mock.calls.length).toBeGreaterThan(activeFetchesBefore)
  })

  it('says so when the provider has no archived offerings', async () => {
    offeringsApi.getArchivedOfferingsByProvider.mockResolvedValue([])
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /Archived offerings/ }))

    expect(screen.getByText('No archived offerings')).toBeInTheDocument()
  })
})

describe('ProviderProfilePage archiving the provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      org: { id: 'org1', name: 'Test Org' } as never,
      user: { id: 'u1', org_id: 'org1', name: 'Tester', email: 't@example.com' } as never,
    })
    providersApi.getProvider.mockResolvedValue(makeProvider())
    providersApi.archiveProvider.mockResolvedValue({ error: null })
    offeringsApi.getOfferingsByProvider.mockResolvedValue([])
    offeringsApi.getArchivedOfferingsByProvider.mockResolvedValue([])
    providerLocationsApi.getProviderLocations.mockResolvedValue([])
  })

  it('refreshes the provider list, data table and counts, which stop listing them', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /archive provider/i }))
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(providersApi.archiveProvider).toHaveBeenCalledWith('p1'))
    await waitFor(() =>
      expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
        expect.arrayContaining([
          ['providers', 'org1'],
          ['data-table-offerings', 'org1'],
          ['case-types-with-counts', 'org1'],
          ['locations-with-counts', 'org1'],
          ['categories-with-counts', 'org1'],
        ]),
      ),
    )
  })
})

describe('ProviderProfilePage booking links by mode', () => {
  const link = (location_id: string, booking_link: string | null, phone: string | null = null) => ({
    provider_id: 'p1',
    location_id,
    booking_link,
    phone,
  })

  function setup({
    orgBooking = 'simple',
    orgPhone = 'simple',
    provider = {},
    rows = [link('l1', 'https://book.example/one'), link('l2', 'https://book.example/one')],
  }: {
    orgBooking?: string
    orgPhone?: string
    provider?: Partial<Provider>
    rows?: ReturnType<typeof link>[]
  } = {}) {
    useAuthStore.setState({
      org: { id: 'org1', name: 'Test Org', default_booking_mode: orgBooking, default_phone_mode: orgPhone } as never,
      user: { id: 'u1', org_id: 'org1', name: 'Tester', email: 't@example.com' } as never,
    })
    providersApi.getProvider.mockResolvedValue(makeProvider(provider))
    providersApi.updateProvider.mockResolvedValue({ error: null })
    providerLocationsApi.upsertProviderLocation.mockResolvedValue({ error: null })
    providerLocationsApi.getProviderLocations.mockResolvedValue(rows)
    offeringsApi.getArchivedOfferingsByProvider.mockResolvedValue([])
    offeringsApi.getOfferingsByProvider.mockResolvedValue([
      { id: 'o1', provider_id: 'p1', org_id: 'org1', case_type_id: 'ct1', location_ids: ['l1', 'l2'], constraints: {}, is_archived: false },
    ])
  }

  beforeEach(() => vi.clearAllMocks())

  it('gives simple mode one booking link and one phone, not a pair per location', async () => {
    setup()
    renderPage()

    expect(await screen.findByLabelText('Booking link (all locations)')).toHaveValue('https://book.example/one')
    expect(screen.getByLabelText('Phone (all locations)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Booking link for Towson')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Phone for Rosedale')).not.toBeInTheDocument()
    expect(screen.getByText('Used at Rosedale, Towson.')).toBeInTheDocument()
  })

  it('gives advanced mode a booking link and phone for each location', async () => {
    setup({ orgBooking: 'advanced', orgPhone: 'advanced' })
    renderPage()

    expect(await screen.findByLabelText('Booking link for Towson')).toBeInTheDocument()
    expect(screen.getByLabelText('Booking link for Rosedale')).toBeInTheDocument()
    expect(screen.getByLabelText('Phone for Towson')).toBeInTheDocument()
    expect(screen.queryByLabelText('Booking link (all locations)')).not.toBeInTheDocument()
  })

  it('follows the provider’s own mode over the account default, one column at a time', async () => {
    setup({ provider: { booking_mode: 'advanced' } })
    renderPage()

    expect(await screen.findByLabelText('Booking link for Towson')).toBeInTheDocument()
    expect(screen.getByLabelText('Phone (all locations)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Phone for Towson')).not.toBeInTheDocument()
  })

  it('saves the one link to every location', async () => {
    setup()
    renderPage()
    const field = await screen.findByLabelText('Booking link (all locations)')

    await userEvent.clear(field)
    await userEvent.type(field, 'https://book.example/new')
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(providerLocationsApi.upsertProviderLocation).toHaveBeenCalledTimes(2))
    expect(providerLocationsApi.upsertProviderLocation.mock.calls).toEqual([
      ['p1', 'l2', 'https://book.example/new', null],
      ['p1', 'l1', 'https://book.example/new', null],
    ])
  })

  it('warns when the locations hold different links, and makes one the link for all on save', async () => {
    setup({
      orgBooking: 'advanced',
      rows: [link('l1', 'https://book.example/towson'), link('l2', 'https://book.example/rosedale')],
    })
    renderPage()
    await screen.findByLabelText('Booking link for Towson')
    expect(screen.queryByText(/different links/)).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getAllByDisplayValue('Use org default')[0], 'simple')

    // The widget uses the first location's link (by id), and so does this field.
    expect(await screen.findByLabelText('Booking link (all locations)')).toHaveValue('https://book.example/towson')
    expect(screen.getByText(/different links/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(providerLocationsApi.upsertProviderLocation).toHaveBeenCalledTimes(2))
    expect(providerLocationsApi.upsertProviderLocation.mock.calls.map((c) => c[2])).toEqual([
      'https://book.example/towson',
      'https://book.example/towson',
    ])
    expect(providersApi.updateProvider).toHaveBeenCalledWith('p1', expect.objectContaining({ booking_mode: 'simple' }))
  })

  it('lets a provider switch mode on its own, without touching anything else', async () => {
    setup({ orgBooking: 'advanced' })
    renderPage()
    await screen.findByLabelText('Booking link for Towson')
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()

    await userEvent.selectOptions(screen.getAllByDisplayValue('Use org default')[0], 'simple')

    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
  })

  it('keeps each location’s own link when saving in advanced mode', async () => {
    setup({
      orgBooking: 'advanced',
      orgPhone: 'advanced',
      rows: [link('l1', 'https://book.example/towson'), link('l2', 'https://book.example/rosedale')],
    })
    renderPage()
    const field = await screen.findByLabelText('Booking link for Rosedale')

    await userEvent.type(field, '2')
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(providerLocationsApi.upsertProviderLocation).toHaveBeenCalledTimes(2))
    const saved = Object.fromEntries(providerLocationsApi.upsertProviderLocation.mock.calls.map((c) => [c[1], c[2]]))
    expect(saved).toEqual({ l1: 'https://book.example/towson', l2: 'https://book.example/rosedale2' })
  })
})
