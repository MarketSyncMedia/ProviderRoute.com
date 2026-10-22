import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaseType, Constraint, Location } from '../../src/types/database'

/**
 * The data table's "Archived" tab. Archiving only flips offerings.is_archived,
 * so the view's whole job is listing those rows and flipping the flag back.
 */

const api = vi.hoisted(() => ({
  getArchivedDataTableOfferings: vi.fn(),
  restoreOfferings: vi.fn(),
}))
vi.mock('../../src/lib/api/dataTable', () => api)

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('../../src/components/ui/toastStore', () => ({ useToast: () => ({ toast }) }))

import ArchivedOfferingsView from '../../src/pages/data-table/ArchivedOfferingsView'

const caseTypes = [{ id: 'ct1', name: 'Knee Pain' }] as CaseType[]
const locations = [
  { id: 'l1', name: 'Downtown' },
  { id: 'l2', name: 'Uptown' },
] as Location[]
const constraints = [
  { id: 'c1', name: 'Accepts Medicare', type: 'binary', mapped_key: 'medicare', secondary_mapped_key: null },
  { id: 'c2', name: 'Age', type: 'range', mapped_key: 'age_min', secondary_mapped_key: 'age_max' },
] as Constraint[]

function offering(id: string, providerName: string, over: Record<string, unknown> = {}) {
  return {
    id,
    provider_id: `p-${id}`,
    case_type_id: 'ct1',
    location_ids: ['l1', 'l2'],
    constraints: { medicare: 1, age_min: 18, age_max: 65 },
    is_archived: true,
    providers: { id: `p-${id}`, name: providerName, category_ids: [], image_url: null },
    ...over,
  }
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <ArchivedOfferingsView
        orgId="org1"
        caseTypes={caseTypes}
        locations={locations}
        constraints={constraints}
      />
    </QueryClientProvider>,
  )
  return { invalidate }
}

describe('ArchivedOfferingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getArchivedDataTableOfferings.mockResolvedValue([
      offering('o1', 'Dr. Jane Smith'),
      offering('o2', 'Dr. Raj Patel', { location_ids: [], constraints: {} }),
    ])
    api.restoreOfferings.mockResolvedValue({ error: null })
  })

  it('lists archived offerings with resolved case type, locations and constraints', async () => {
    renderView()

    const row = (await screen.findByText('Dr. Jane Smith')).closest('tr') as HTMLElement
    expect(within(row).getByText('Knee Pain')).toBeInTheDocument()
    expect(within(row).getByText('Downtown, Uptown')).toBeInTheDocument()
    expect(within(row).getByText('Accepts Medicare, Age: 18–65')).toBeInTheDocument()
    expect(screen.getByText('Showing 2 of 2 archived offerings')).toBeInTheDocument()
    expect(api.getArchivedDataTableOfferings).toHaveBeenCalledWith('org1')
  })

  it('restores one offering and refreshes the data table lists', async () => {
    const { invalidate } = renderView()
    const row = (await screen.findByText('Dr. Jane Smith')).closest('tr') as HTMLElement

    await userEvent.click(within(row).getByRole('button', { name: /restore/i }))

    await waitFor(() => expect(api.restoreOfferings).toHaveBeenCalledWith(['o1']))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Offering restored'))
    // The prefix key is what refreshes both the active and archived lists.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['data-table-offerings', 'org1'] })
  })

  it('restores every selected offering in one call', async () => {
    renderView()
    await screen.findByText('Dr. Jane Smith')

    await userEvent.click(screen.getByLabelText('Select all archived offerings on this page'))
    await userEvent.click(screen.getByRole('button', { name: 'Restore Selected (2)' }))

    await waitFor(() => expect(api.restoreOfferings).toHaveBeenCalledWith(['o1', 'o2']))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 offerings restored'))
  })

  it('keeps the row and shows the error when the restore fails', async () => {
    api.restoreOfferings.mockResolvedValue({ error: 'permission denied' })
    renderView()
    const row = (await screen.findByText('Dr. Jane Smith')).closest('tr') as HTMLElement

    await userEvent.click(within(row).getByRole('button', { name: /restore/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('permission denied'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByText('Dr. Jane Smith')).toBeInTheDocument()
  })

  it('filters by provider name', async () => {
    renderView()
    await screen.findByText('Dr. Jane Smith')

    await userEvent.type(screen.getByLabelText('Search archived offerings by provider'), 'patel')

    expect(screen.queryByText('Dr. Jane Smith')).not.toBeInTheDocument()
    expect(screen.getByText('Dr. Raj Patel')).toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 2 archived offerings')).toBeInTheDocument()
  })

  it('shows an empty state when nothing is archived', async () => {
    api.getArchivedDataTableOfferings.mockResolvedValue([])
    renderView()

    expect(await screen.findByText('No archived offerings')).toBeInTheDocument()
  })
})
