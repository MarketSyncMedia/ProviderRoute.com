import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Data Table's Add button shipped to production as
 * `alert('Add flow coming soon')`. This drives the real page: Add opens the
 * offering form, and saving it creates the offering for this org.
 */

const dataTableApi = vi.hoisted(() => ({
  archiveAllOfferings: vi.fn(),
  archiveOfferings: vi.fn(),
  getDataTableOfferings: vi.fn(),
  updateOfferingCaseType: vi.fn(),
  updateOfferingConstraint: vi.fn(),
  updateOfferingLocationIds: vi.fn(),
  updateProviderCategories: vi.fn(),
}))
vi.mock('../../src/lib/api/dataTable', () => dataTableApi)

const offeringsApi = vi.hoisted(() => ({ createOffering: vi.fn() }))
vi.mock('../../src/lib/api/offerings', () => offeringsApi)

const providersApi = vi.hoisted(() => ({ getProviders: vi.fn() }))
vi.mock('../../src/lib/api/providers', () => providersApi)

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('../../src/components/ui/toastStore', () => ({ useToast: () => ({ toast }) }))

vi.mock('../../src/components/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../../src/pages/data-table/ArchivedOfferingsView', () => ({ default: () => null }))

const tables: Record<string, unknown[]> = {
  locations: [{ id: 'l1', name: 'Towson' }],
  constraints: [],
  case_types: [{ id: 'ct1', name: 'Knee' }],
  categories: [],
}

// Chainable stand-in for the supabase-js builder the page uses for its lookups.
function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = chain
  builder.eq = chain
  builder.order = chain
  builder.then = (
    onfulfilled?: ((v: typeof result) => unknown) | null,
    onrejected?: ((e: unknown) => unknown) | null,
  ) => Promise.resolve(result).then(onfulfilled, onrejected)
  return builder
}

vi.mock('../../src/lib/supabase', () => ({
  supabase: { from: vi.fn((table: string) => makeQueryBuilder({ data: tables[table] ?? [], error: null })) },
}))

import DataTablePage from '../../src/pages/data-table/DataTablePage'
import { useAuthStore } from '../../src/stores/authStore'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DataTablePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DataTablePage add offering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ org: { id: 'org1', name: 'TOA' } as never })
    dataTableApi.getDataTableOfferings.mockResolvedValue([])
    providersApi.getProviders.mockResolvedValue([{ id: 'p1', name: 'Dr. Adams' }])
    offeringsApi.createOffering.mockResolvedValue({ data: { id: 'o1' }, error: null })
  })

  it('opens the offering form instead of a "coming soon" alert, and creates the offering', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /^add$/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Add Offering' })
    expect(alertSpy).not.toHaveBeenCalled()

    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Dr. Adams' })).toBeInTheDocument())
    await user.selectOptions(within(dialog).getByLabelText('Provider'), 'p1')
    await user.selectOptions(within(dialog).getByLabelText('Case Type'), 'ct1')
    await user.click(within(dialog).getByLabelText('Towson'))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(offeringsApi.createOffering).toHaveBeenCalledWith({
        provider_id: 'p1',
        case_type_id: 'ct1',
        org_id: 'org1',
        location_ids: ['l1'],
        constraints: {},
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Offering' })).not.toBeInTheDocument())
    expect(toast.success).toHaveBeenCalledWith('Offering added')
    alertSpy.mockRestore()
  })

  it('keeps the form open and shows the error when the save fails', async () => {
    offeringsApi.createOffering.mockResolvedValue({ data: null, error: 'permission denied' })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /^add$/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Add Offering' })
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Dr. Adams' })).toBeInTheDocument())
    await user.selectOptions(within(dialog).getByLabelText('Provider'), 'p1')
    await user.selectOptions(within(dialog).getByLabelText('Case Type'), 'ct1')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await within(dialog).findByText('permission denied')).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
