import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaseType } from '../../src/types/database'

/**
 * Pins the modal form-reset behaviour of CaseTypesPage, its body map section,
 * archiving for all or some providers, and restoring archived case types.
 *
 * The page used to reset `name`/`formError` from an effect watching `modal`,
 * which cascades an extra render on every open. These tests describe the
 * behaviour a user can observe, so the same assertions hold before and after
 * moving that reset into the handlers that open the modal.
 *
 * Case type names also appear in the body map section (its dropdowns and the
 * "not on the body map" list), so list assertions are scoped to the list.
 */

const caseType = (over: Partial<CaseType> = {}): CaseType =>
  ({
    id: 'ct1',
    org_id: 'org1',
    name: 'Knee Pain',
    sort_order: 0,
    map_tag: null,
    is_archived: false,
    created_at: '',
    updated_at: '',
    ...over,
  }) as CaseType

const api = vi.hoisted(() => ({
  getCaseTypes: vi.fn(),
  getCaseTypeOfferingCounts: vi.fn(),
  createCaseType: vi.fn(),
  updateCaseType: vi.fn(),
  updateCaseTypeOrders: vi.fn(),
  archiveCaseType: vi.fn(),
  updateCaseTypeMapTag: vi.fn(),
  getArchivedCaseTypes: vi.fn(),
  restoreCaseType: vi.fn(),
  getCaseTypeProviders: vi.fn(),
}))
const dataTableApi = vi.hoisted(() => ({ archiveOfferings: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))

vi.mock('../../src/lib/api/caseTypes', () => api)
vi.mock('../../src/lib/api/dataTable', () => dataTableApi)
vi.mock('../../src/components/ui/toastStore', () => ({ useToast: () => ({ toast }) }))

import CaseTypesPage from '../../src/pages/case-types/CaseTypesPage'
import { useAuthStore } from '../../src/stores/authStore'

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CaseTypesPage />
    </QueryClientProvider>,
  )
}

/** The draggable case type list, as opposed to the body map section. */
async function list() {
  return screen.findByRole('region', { name: 'case types' })
}

/** The list row for a case type. */
async function row(name: string) {
  return within(await list())
    .getByText(name)
    .closest('div') as HTMLElement
}

/** The dialog is the element containing the name input. */
function dialog() {
  return screen.getByRole('textbox').closest('div[class*="fixed"], form, div') as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    org: { id: 'org1', name: 'Test Org' } as never,
    user: { id: 'u1', org_id: 'org1', name: 'Tester', email: 't@example.com' } as never,
  })
  api.getCaseTypes.mockResolvedValue([
    caseType({ id: 'ct1', name: 'Knee Pain', sort_order: 0 }),
    caseType({ id: 'ct2', name: 'Shoulder Pain', sort_order: 1 }),
  ])
  api.getCaseTypeOfferingCounts.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, 0])),
  )
  api.createCaseType.mockResolvedValue({ error: null })
  api.updateCaseType.mockResolvedValue({ error: null })
  api.archiveCaseType.mockResolvedValue({ error: null })
  api.updateCaseTypeMapTag.mockResolvedValue({ error: null })
  api.getArchivedCaseTypes.mockResolvedValue([])
  api.restoreCaseType.mockResolvedValue({ error: null, lostSpot: false })
  api.getCaseTypeProviders.mockResolvedValue([])
  dataTableApi.archiveOfferings.mockResolvedValue({ error: null })
})

describe('CaseTypesPage modal state', () => {
  it('opens the add dialog with an empty name field', async () => {
    const user = userEvent.setup()
    renderPage()
    await row('Knee Pain')

    await user.click(screen.getByRole('button', { name: /add case type/i }))

    const input = await screen.findByRole('textbox')
    expect(input).toHaveValue('')
  })

  it('opens the edit dialog prefilled with that row’s name', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(within(await row('Shoulder Pain')).getByRole('button', { name: /edit/i }))

    expect(await screen.findByRole('textbox')).toHaveValue('Shoulder Pain')
  })

  it('does not carry a typed value from one open to the next', async () => {
    const user = userEvent.setup()
    renderPage()
    await row('Knee Pain')

    // Type into add, then close without saving.
    await user.click(screen.getByRole('button', { name: /add case type/i }))
    await user.type(await screen.findByRole('textbox'), 'Discarded draft')
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    // Reopening must start clean, not show the discarded draft.
    await user.click(screen.getByRole('button', { name: /add case type/i }))
    expect(await screen.findByRole('textbox')).toHaveValue('')
  })

  it('clears a validation error when the dialog is reopened', async () => {
    const user = userEvent.setup()
    renderPage()
    await row('Knee Pain')

    // A single character trips the minimum-length check.
    await user.click(screen.getByRole('button', { name: /add case type/i }))
    await user.type(await screen.findByRole('textbox'), 'x')
    await user.click(screen.getByRole('button', { name: /^save$|^add$|^create$/i }))

    const error = await screen.findByText(/at least 2 characters/i)
    expect(error).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    await user.click(screen.getByRole('button', { name: /add case type/i }))

    await waitFor(() => {
      expect(screen.queryByText(/at least 2 characters/i)).not.toBeInTheDocument()
    })
  })

  it('renders rows in the order the query returned them', async () => {
    renderPage()
    const region = await list()
    await within(region).findByText('Knee Pain')

    const all = region.textContent ?? ''
    expect(all.indexOf('Knee Pain')).toBeLessThan(all.indexOf('Shoulder Pain'))
    expect(within(region).getAllByRole('button', { name: /edit case type/i })).toHaveLength(2)
  })

  it('picks up a reordered list when the query data changes', async () => {
    const user = userEvent.setup()
    renderPage()
    await row('Knee Pain')

    // Simulate the post-save refetch returning a new order.
    api.getCaseTypes.mockResolvedValue([
      caseType({ id: 'ct2', name: 'Shoulder Pain', sort_order: 0 }),
      caseType({ id: 'ct1', name: 'Knee Pain', sort_order: 1 }),
    ])

    // Any mutation triggers invalidation; adding one is the simplest trigger.
    await user.click(screen.getByRole('button', { name: /add case type/i }))
    await user.type(await screen.findByRole('textbox'), 'Ankle Pain')
    await user.click(screen.getByRole('button', { name: /^save$|^add$|^create$/i }))

    await waitFor(async () => {
      const all = (await list()).textContent ?? ''
      expect(all.indexOf('Shoulder Pain')).toBeLessThan(all.indexOf('Knee Pain'))
    })
  })

  it('switching from edit straight to add clears the prefilled name', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(within(await row('Knee Pain')).getByRole('button', { name: /edit/i }))
    expect(await screen.findByRole('textbox')).toHaveValue('Knee Pain')

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    await user.click(screen.getByRole('button', { name: /add case type/i }))

    expect(await screen.findByRole('textbox')).toHaveValue('')
  })
})

describe('CaseTypesPage body map section', () => {
  it('links the case type picked for a spot', async () => {
    const user = userEvent.setup()
    renderPage()
    const select = await screen.findByRole('combobox', { name: 'Case type for Knee' })
    expect(select).toHaveValue('')

    await user.selectOptions(select, 'Knee Pain')

    expect(api.updateCaseTypeMapTag).toHaveBeenCalledTimes(1)
    expect(api.updateCaseTypeMapTag).toHaveBeenCalledWith('ct1', 'knee')
  })

  it('unlinks the current holder before linking another case type to its spot', async () => {
    api.getCaseTypes.mockResolvedValue([
      caseType({ id: 'ct1', name: 'Knee Pain', map_tag: 'knee' }),
      caseType({ id: 'ct2', name: 'Shoulder Pain', sort_order: 1 }),
    ])
    const user = userEvent.setup()
    renderPage()
    const select = await screen.findByRole('combobox', { name: 'Case type for Knee' })
    await waitFor(() => expect(select).toHaveValue('ct1'))

    await user.selectOptions(select, 'Shoulder Pain')

    await waitFor(() => expect(api.updateCaseTypeMapTag).toHaveBeenCalledTimes(2))
    expect(api.updateCaseTypeMapTag.mock.calls).toEqual([
      ['ct1', null],
      ['ct2', 'knee'],
    ])
  })

  it('does not link the new case type if unlinking the holder fails', async () => {
    api.getCaseTypes.mockResolvedValue([
      caseType({ id: 'ct1', name: 'Knee Pain', map_tag: 'knee' }),
      caseType({ id: 'ct2', name: 'Shoulder Pain', sort_order: 1 }),
    ])
    api.updateCaseTypeMapTag.mockResolvedValueOnce({ error: 'permission denied' })
    const user = userEvent.setup()
    renderPage()
    const select = await screen.findByRole('combobox', { name: 'Case type for Knee' })
    await waitFor(() => expect(select).toHaveValue('ct1'))

    await user.selectOptions(select, 'Shoulder Pain')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('permission denied'))
    expect(api.updateCaseTypeMapTag).toHaveBeenCalledTimes(1)
  })

  it('moves a case type already on another spot with one update', async () => {
    api.getCaseTypes.mockResolvedValue([caseType({ id: 'ct1', name: 'Knee Pain', map_tag: 'knee' })])
    const user = userEvent.setup()
    renderPage()
    const select = await screen.findByRole('combobox', { name: 'Case type for Shoulder' })

    await user.selectOptions(select, 'Knee Pain (moves from Knee)')

    expect(api.updateCaseTypeMapTag).toHaveBeenCalledTimes(1)
    expect(api.updateCaseTypeMapTag).toHaveBeenCalledWith('ct1', 'shoulder')
  })

  it('removes a spot from the body map with null, not an empty string', async () => {
    api.getCaseTypes.mockResolvedValue([caseType({ id: 'ct1', name: 'Knee Pain', map_tag: 'knee' })])
    const user = userEvent.setup()
    renderPage()
    const remove = await screen.findByRole('button', { name: 'Remove Knee from the body map' })
    expect(screen.getByRole('button', { name: 'Remove Shoulder from the body map' })).toBeDisabled()

    await user.click(remove)

    expect(api.updateCaseTypeMapTag).toHaveBeenCalledWith('ct1', null)
    expect(api.archiveCaseType).not.toHaveBeenCalled()
  })

  it('marks linked rows in the list and lists the case types not on the map', async () => {
    api.getCaseTypes.mockResolvedValue([
      caseType({ id: 'ct1', name: 'Knee Pain', map_tag: 'knee' }),
      caseType({ id: 'ct2', name: 'Shoulder Pain', sort_order: 1 }),
    ])
    renderPage()

    expect(within(await row('Knee Pain')).getByText('Knee')).toBeInTheDocument()
    const offMap = (await screen.findByRole('heading', { name: /not on the body map \(1\)/i })).parentElement!
    expect(within(offMap).getByText('Shoulder Pain')).toBeInTheDocument()
    expect(within(offMap).queryByText('Knee Pain')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 17 spots linked')).toBeInTheDocument()
  })

  it('applies only the suggestions left ticked', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /suggest body map matches/i }))
    const review = await screen.findByRole('dialog', { name: /suggested body map matches/i })
    expect(api.updateCaseTypeMapTag).not.toHaveBeenCalled()

    await user.click(within(review).getByRole('checkbox', { name: /shoulder pain/i }))
    await user.click(within(review).getByRole('button', { name: 'Apply 1' }))

    await waitFor(() => expect(api.updateCaseTypeMapTag).toHaveBeenCalledTimes(1))
    expect(api.updateCaseTypeMapTag).toHaveBeenCalledWith('ct1', 'knee')
  })

  it('writes nothing when the review is cancelled', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /suggest body map matches/i }))
    const review = await screen.findByRole('dialog', { name: /suggested body map matches/i })
    await user.click(within(review).getByRole('button', { name: /cancel/i }))

    expect(screen.queryByRole('dialog', { name: /suggested body map matches/i })).not.toBeInTheDocument()
    expect(api.updateCaseTypeMapTag).not.toHaveBeenCalled()
  })
})

describe('CaseTypesPage archiving', () => {
  beforeEach(() => {
    api.getCaseTypeOfferingCounts.mockImplementation(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, id === 'ct1' ? 3 : 0])),
    )
    api.getCaseTypeProviders.mockResolvedValue([
      { providerId: 'p1', providerName: 'Dr. Adams', offeringIds: ['o1', 'o2'] },
      { providerId: 'p2', providerName: 'Dr. Baker', offeringIds: ['o3'] },
    ])
  })

  async function openArchive(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(within(await row(name)).getByRole('button', { name: /archive case type/i }))
  }

  it('archives the case type itself for all providers by default', async () => {
    const user = userEvent.setup()
    renderPage()
    await openArchive(user, 'Knee Pain')

    expect(screen.getByText('Knee Pain is used in 3 offerings.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Archive for all providers' }))

    await waitFor(() => expect(api.archiveCaseType).toHaveBeenCalledWith('ct1'))
    expect(dataTableApi.archiveOfferings).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Knee Pain archived for all providers')
  })

  it('archives only the ticked providers’ offerings, leaving the case type', async () => {
    const user = userEvent.setup()
    renderPage()
    await openArchive(user, 'Knee Pain')

    await user.click(screen.getByRole('radio', { name: /only some providers/i }))
    const confirm = screen.getByRole('button', { name: 'Archive for 0 providers' })
    expect(confirm).toBeDisabled()

    await user.click(await screen.findByRole('checkbox', { name: /dr\. adams/i }))
    await user.click(screen.getByRole('button', { name: 'Archive for 1 provider' }))

    await waitFor(() => expect(dataTableApi.archiveOfferings).toHaveBeenCalledWith(['o1', 'o2']))
    expect(api.getCaseTypeProviders).toHaveBeenCalledWith('ct1')
    expect(api.archiveCaseType).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Knee Pain archived for 1 provider')
  })

  it('selects every provider at once', async () => {
    const user = userEvent.setup()
    renderPage()
    await openArchive(user, 'Knee Pain')
    await user.click(screen.getByRole('radio', { name: /only some providers/i }))

    await user.click(await screen.findByRole('button', { name: 'Select all' }))
    await user.click(screen.getByRole('button', { name: 'Archive for 2 providers' }))

    await waitFor(() => expect(dataTableApi.archiveOfferings).toHaveBeenCalledWith(['o1', 'o2', 'o3']))
  })

  it('offers no per-provider choice for a case type nobody offers', async () => {
    const user = userEvent.setup()
    renderPage()
    await openArchive(user, 'Shoulder Pain')

    expect(screen.getByText('Shoulder Pain is not used in any offerings.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /only some providers/i })).toBeDisabled()
  })

  it('keeps the dialog open and reports a failed archive', async () => {
    api.archiveCaseType.mockResolvedValue({ error: 'network down' })
    const user = userEvent.setup()
    renderPage()
    await openArchive(user, 'Knee Pain')

    await user.click(screen.getByRole('button', { name: 'Archive for all providers' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('network down'))
    expect(screen.getByRole('button', { name: 'Archive for all providers' })).toBeInTheDocument()
  })
})

describe('CaseTypesPage archived case types', () => {
  const archivedHip = caseType({ id: 'ct9', name: 'Hip Pain', is_archived: true, map_tag: 'hip' })

  it('is hidden when nothing is archived', async () => {
    renderPage()
    await row('Knee Pain')
    expect(screen.queryByRole('button', { name: /archived case types/i })).not.toBeInTheDocument()
  })

  it('restores an archived case type', async () => {
    api.getArchivedCaseTypes.mockResolvedValue([archivedHip])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Archived case types (1)' }))
    await user.click(screen.getByRole('button', { name: 'Restore Hip Pain' }))

    await waitFor(() => expect(api.restoreCaseType).toHaveBeenCalledWith(archivedHip))
    expect(toast.success).toHaveBeenCalledWith('Hip Pain restored')
  })

  it('says so when the restored case type’s spot was taken meanwhile', async () => {
    api.getArchivedCaseTypes.mockResolvedValue([archivedHip])
    api.restoreCaseType.mockResolvedValue({ error: null, lostSpot: true })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Archived case types (1)' }))
    await user.click(screen.getByRole('button', { name: 'Restore Hip Pain' }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/body map spot \(Hip\)/)))
  })
})

export { dialog }
