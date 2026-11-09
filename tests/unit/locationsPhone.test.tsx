import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Location phones were typed as "4103377900", "(410) 337-7900" and everything
 * between, so the one table read three ways. They are shown, and now saved,
 * the one way.
 */

const api = vi.hoisted(() => ({
  getLocations: vi.fn(),
  getLocationOfferingCounts: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  archiveLocation: vi.fn(),
}))
vi.mock('../../src/lib/api/locations', () => api)
vi.mock('../../src/components/ui/toastStore', () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }),
}))

import LocationsPage from '../../src/pages/locations/LocationsPage'
import { useAuthStore } from '../../src/stores/authStore'

const location = (over: Record<string, unknown>) => ({
  org_id: 'org1',
  address: null,
  directions_url: null,
  sort_order: 0,
  is_archived: false,
  ...over,
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <LocationsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    org: { id: 'org1', name: 'Test Org' } as never,
    user: { id: 'u1', org_id: 'org1', name: 'Tester', email: 't@example.com' } as never,
  })
  api.getLocations.mockResolvedValue([
    location({ id: 'l1', name: 'Bel Air', phone: '4103377900' }),
    location({ id: 'l2', name: 'Rosedale', phone: '(410) 337-7900' }),
    location({ id: 'l3', name: 'Towson', phone: '410-337-7900' }),
    location({ id: 'l4', name: 'Annex', phone: null }),
  ])
  api.getLocationOfferingCounts.mockResolvedValue({})
  api.createLocation.mockResolvedValue({ error: null })
  api.updateLocation.mockResolvedValue({ error: null })
})

describe('LocationsPage phones', () => {
  it('shows every phone the same way', async () => {
    renderPage()
    await screen.findByText('Bel Air')

    for (const name of ['Bel Air', 'Rosedale', 'Towson']) {
      const row = screen.getByText(name).closest('tr') as HTMLElement
      expect(within(row).getByText('(410) 337-7900')).toBeInTheDocument()
    }
    // No phone stays a dash, not a stray number.
    expect(screen.getByText('Annex').closest('tr')).not.toHaveTextContent(/\d{3}/)
  })

  it('saves a new location’s phone in that form', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Bel Air')

    await user.click(screen.getByRole('button', { name: /add location/i }))
    const dialog = (await screen.findByRole('heading', { name: 'Add Location' })).parentElement as HTMLElement
    const [name, , phone] = within(dialog).getAllByRole('textbox')
    await user.type(name, 'Bowie')
    await user.type(phone, '4105550123')
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))

    await waitFor(() =>
      expect(api.createLocation).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bowie', phone: '(410) 555-0123' })),
    )
  })

  it('shows an existing phone formatted when editing, and saves it that way', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Bel Air')

    const row = screen.getByText('Bel Air').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /edit location/i }))
    const dialog = (await screen.findByRole('heading', { name: 'Edit Location' })).parentElement as HTMLElement
    const phone = within(dialog).getAllByRole('textbox')[2]
    expect(phone).toHaveValue('(410) 337-7900')
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))

    await waitFor(() =>
      expect(api.updateLocation).toHaveBeenCalledWith('l1', expect.objectContaining({ phone: '(410) 337-7900' })),
    )
  })
})
