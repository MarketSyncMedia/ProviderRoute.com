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

vi.mock('../../src/components/ui/toastStore', () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }),
}))

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
    from: vi.fn(() => makeQueryBuilder({ data: [], error: null })),
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
    expect(screen.getByText('medicare: 1')).toBeInTheDocument()
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
