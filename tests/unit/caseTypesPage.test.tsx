import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  updateCaseTypeMapPosition: vi.fn(),
  getArchivedCaseTypes: vi.fn(),
  restoreCaseType: vi.fn(),
  getCaseTypeProviders: vi.fn(),
}))
const dataTableApi = vi.hoisted(() => ({ archiveOfferings: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))

vi.mock('../../src/lib/api/caseTypes', () => api)
vi.mock('../../src/lib/api/dataTable', () => dataTableApi)
vi.mock('../../src/components/ui/toastStore', () => ({ useToast: () => ({ toast }) }))

import { bodyMapSpot } from '../../src/shared/bodyMap'
import CaseTypesPage from '../../src/pages/case-types/CaseTypesPage'
import { useAuthStore } from '../../src/stores/authStore'

let client: QueryClient

function renderPage() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CaseTypesPage />
    </QueryClientProvider>,
  )
}

/** The query keys invalidated so far, for checking which pages refresh. */
function invalidatedKeys(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey)
}

/** The offering views that must refresh when a case type is archived or restored. */
const OFFERING_VIEWS = [['data-table-offerings', 'org1'], ['provider-offerings'], ['locations-with-counts', 'org1']]

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
  const knee = bodyMapSpot('knee')!
  const section = async (count: number) =>
    (await screen.findByRole('heading', { name: new RegExp(`^on the body map \\(${count}\\)`, 'i') })).parentElement!

  beforeEach(() => {
    api.updateCaseTypeMapPosition.mockResolvedValue({ error: null })
  })

  it('lists every case type on the map in one list, standard spot or placed by hand', async () => {
    api.getCaseTypes.mockResolvedValue([
      caseType({ id: 'ct1', name: 'Knee Pain', map_tag: 'knee' }),
      caseType({ id: 'pec', name: 'Pectoral', sort_order: 1, map_view: 'front', map_x: 45, map_y: 27 } as Partial<CaseType>),
      caseType({ id: 'ct2', name: 'Shoulder Pain', sort_order: 2 }),
    ])
    renderPage()

    const onMap = await section(2)
    expect(within(onMap).getByText('Knee Pain')).toBeInTheDocument()
    expect(within(onMap).getByText('Pectoral')).toBeInTheDocument()
    expect(within(onMap).queryByText('Shoulder Pain')).not.toBeInTheDocument()
    // Both kinds get the same Move and Remove buttons.
    expect(within(onMap).getByRole('button', { name: 'Move Knee Pain on the body map' })).toBeInTheDocument()
    expect(within(onMap).getByRole('button', { name: 'Move Pectoral on the body map' })).toBeInTheDocument()
    const offMap = (await screen.findByRole('heading', { name: /not on the body map \(1\)/i })).parentElement!
    expect(within(offMap).getByText('Shoulder Pain')).toBeInTheDocument()
    expect(screen.getByText('2 of 3 case types on the map')).toBeInTheDocument()
    expect(screen.queryByText(/placed by you/i)).not.toBeInTheDocument()
  })

  it('marks every case type on the map the same way in the list, standard spot or placed', async () => {
    api.getCaseTypes.mockResolvedValue([
      caseType({ id: 'ct1', name: 'Knee Pain', map_tag: 'knee' }),
      caseType({ id: 'pec', name: 'Pectoral', sort_order: 1, map_view: 'front', map_x: 45, map_y: 27 } as Partial<CaseType>),
      caseType({ id: 'ct2', name: 'Shoulder Pain', sort_order: 2 }),
    ])
    renderPage()
    expect(within(await row('Knee Pain')).getByText('Body map')).toBeInTheDocument()
    expect(within(await row('Pectoral')).getByText('Body map')).toBeInTheDocument()
    expect(within(await row('Shoulder Pain')).queryByText('Body map')).not.toBeInTheDocument()
  })

  it('never shows a case type that was archived, even one that kept its spot', async () => {
    api.getCaseTypes.mockResolvedValue([
      caseType({ id: 'ct1', name: 'Knee Pain', map_tag: 'knee' }),
      caseType({ id: 'neck', name: 'Neck', sort_order: 1, map_tag: 'neck', is_archived: true }),
    ])
    renderPage()

    const onMap = await section(1)
    expect(within(onMap).queryByText('Neck')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 1 case types on the map')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Neck/ })).not.toBeInTheDocument()
  })

  it('removes a case type from the map with null, whichever kind of spot it had', async () => {
    api.getCaseTypes.mockResolvedValue([caseType({ id: 'ct1', name: 'Knee Pain', map_tag: 'knee' })])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Remove Knee Pain from the body map' }))

    expect(api.updateCaseTypeMapPosition).toHaveBeenCalledWith('ct1', null)
    expect(api.updateCaseTypeMapTag).not.toHaveBeenCalled()
    expect(api.archiveCaseType).not.toHaveBeenCalled()
  })

  it('moves a standard-spot case type from where it sits, saving its own position', async () => {
    api.getCaseTypes.mockResolvedValue([caseType({ id: 'ct1', name: 'Knee Pain', map_tag: 'knee' })])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Move Knee Pain on the body map' }))
    const dialog = screen.getByRole('dialog', { name: 'Place Knee Pain on the body map' })
    await user.click(within(dialog).getByRole('button', { name: 'Place the dot' }))
    await user.click(within(dialog).getByRole('button', { name: 'Nudge right' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save placement' }))

    await waitFor(() => expect(api.updateCaseTypeMapPosition).toHaveBeenCalledTimes(1))
    const [id, position] = api.updateCaseTypeMapPosition.mock.calls[0]
    expect(id).toBe('ct1')
    expect(position).toMatchObject({ view: 'front', x: knee.x + 1, y: knee.y })
    // The label starts where the widget draws the standard one.
    expect(position.labelX).not.toBeNull()
    expect(position.labelY).not.toBeNull()
  })

  it('starts a case type from a standard spot', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Place Knee Pain on the body map' }))
    const dialog = screen.getByRole('dialog', { name: 'Place Knee Pain on the body map' })
    expect(within(dialog).getByRole('button', { name: 'Save placement' })).toBeDisabled()

    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Start from a standard spot' }), 'Knee')
    await user.click(within(dialog).getByRole('button', { name: 'Save placement' }))

    await waitFor(() => expect(api.updateCaseTypeMapPosition).toHaveBeenCalledTimes(1))
    expect(api.updateCaseTypeMapPosition.mock.calls[0][1]).toMatchObject({ view: 'front', x: knee.x, y: knee.y })
  })

  it('offers only the standard spots no other case type is using', async () => {
    api.getCaseTypes.mockResolvedValue([
      caseType({ id: 'ct1', name: 'Knee Pain' }),
      caseType({ id: 'ct2', name: 'Shoulder Pain', sort_order: 1, map_tag: 'shoulder' }),
      caseType({ id: 'neck', name: 'Neck', sort_order: 2, map_tag: 'neck', is_archived: true }),
    ])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Place Knee Pain on the body map' }))
    const select = screen.getByRole('combobox', { name: 'Start from a standard spot' })

    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('Knee')
    expect(options).not.toContain('Shoulder')
    // An archived case type frees its spot while it is archived.
    expect(options).toContain('Neck')
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

describe('CaseTypesPage placing case types on the body map', () => {
  beforeEach(() => {
    api.updateCaseTypeMapPosition.mockResolvedValue({ error: null })
  })

  /** jsdom has no layout, so give the dialog's map a size to click inside. */
  function sizeMap(dialog: HTMLElement) {
    const svg = dialog.querySelector('svg[role="img"]') as SVGSVGElement
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1334, height: 1254, right: 1334, bottom: 1254, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return svg
  }

  async function openPlace(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Place Knee Pain on the body map' }))
    return screen.getByRole('dialog', { name: 'Place Knee Pain on the body map' })
  }

  it('offers to place a case type that has no spot', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: 'Place Knee Pain on the body map' })).toBeInTheDocument()
  })

  it('saves the dot where the admin clicked, then the label', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openPlace(user)
    const svg = sizeMap(dialog)
    expect(within(dialog).getByRole('button', { name: 'Save placement' })).toBeDisabled()

    // The drawing starts at x = -40, so clientX 400 is outline x 360 (inside the front figure).
    fireEvent.click(svg, { clientX: 400, clientY: 300 })
    expect(within(dialog).getByRole('button', { name: 'Place the label' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(svg, { clientX: 100, clientY: 280 })
    await user.click(within(dialog).getByRole('button', { name: 'Save placement' }))

    await waitFor(() => expect(api.updateCaseTypeMapPosition).toHaveBeenCalledTimes(1))
    const [id, position] = api.updateCaseTypeMapPosition.mock.calls[0]
    expect(id).toBe('ct1')
    expect(position.view).toBe('front')
    expect(position.x).toBeCloseTo(((360 - 99.1) / 518.7) * 100, 1)
    expect(position.y).toBeCloseTo(((300 - 19.4) / 1184.2) * 100, 1)
    expect(position.labelX).toBeLessThan(position.x)
    expect(api.updateCaseTypeMapTag).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Knee Pain placed on the body map')
    expect(screen.queryByRole('dialog', { name: /place knee pain/i })).not.toBeInTheDocument()
  })

  it('saves the dot alone when the label is left to the default', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openPlace(user)
    fireEvent.click(sizeMap(dialog), { clientX: 800, clientY: 500 })
    await user.click(within(dialog).getByRole('button', { name: 'Save placement' }))

    await waitFor(() => expect(api.updateCaseTypeMapPosition).toHaveBeenCalled())
    expect(api.updateCaseTypeMapPosition.mock.calls[0][1]).toMatchObject({ view: 'back', labelX: null, labelY: null })
  })

  it('nudges the dot a percent at a time, for precision and for the keyboard', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openPlace(user)
    fireEvent.click(sizeMap(dialog), { clientX: 400, clientY: 300 })
    await user.click(within(dialog).getByRole('button', { name: 'Place the dot' }))
    await user.click(within(dialog).getByRole('button', { name: 'Nudge right' }))
    await user.click(within(dialog).getByRole('button', { name: 'Nudge down' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save placement' }))

    await waitFor(() => expect(api.updateCaseTypeMapPosition).toHaveBeenCalled())
    const position = api.updateCaseTypeMapPosition.mock.calls[0][1]
    expect(position.x).toBeCloseTo(((360 - 99.1) / 518.7) * 100 + 1, 1)
    expect(position.y).toBeCloseTo(((300 - 19.4) / 1184.2) * 100 + 1, 1)
  })

  it('writes nothing when cancelled', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openPlace(user)
    fireEvent.click(sizeMap(dialog), { clientX: 400, clientY: 300 })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(api.updateCaseTypeMapPosition).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the dialog open and says so when the save fails', async () => {
    api.updateCaseTypeMapPosition.mockResolvedValue({ error: 'nope' })
    const user = userEvent.setup()
    renderPage()
    const dialog = await openPlace(user)
    fireEvent.click(sizeMap(dialog), { clientX: 400, clientY: 300 })
    await user.click(within(dialog).getByRole('button', { name: 'Save placement' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('nope'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  describe('a case type already placed', () => {
    const placed = () =>
      caseType({ id: 'pec', name: 'Pectoral', map_view: 'front', map_x: 45, map_y: 27 } as Partial<CaseType>)

    beforeEach(() => {
      api.getCaseTypes.mockResolvedValue([caseType(), placed()])
    })

    it('is listed on the map, not as off the map', async () => {
      renderPage()
      const section = (await screen.findByRole('heading', { name: /^on the body map \(1\)/i })).parentElement!
      expect(within(section).getByText('Pectoral')).toBeInTheDocument()
      const offMap = (await screen.findByRole('heading', { name: /not on the body map \(1\)/i })).parentElement!
      expect(within(offMap).queryByText('Pectoral')).not.toBeInTheDocument()
      expect(screen.getByText('1 of 2 case types on the map')).toBeInTheDocument()
    })

    it('opens with its spot when moved', async () => {
      const user = userEvent.setup()
      renderPage()
      await user.click(await screen.findByRole('button', { name: 'Move Pectoral on the body map' }))
      const dialog = screen.getByRole('dialog', { name: 'Place Pectoral on the body map' })
      expect(within(dialog).getByRole('button', { name: 'Save placement' })).toBeEnabled()
    })

    it('is taken off the map with null, leaving the case type itself alone', async () => {
      const user = userEvent.setup()
      renderPage()
      await user.click(await screen.findByRole('button', { name: 'Remove Pectoral from the body map' }))

      expect(api.updateCaseTypeMapPosition).toHaveBeenCalledWith('pec', null)
      expect(api.archiveCaseType).not.toHaveBeenCalled()
    })
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

  it('refreshes the data table and provider pages, which stop listing its offerings', async () => {
    const user = userEvent.setup()
    renderPage()
    await openArchive(user, 'Knee Pain')
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'Archive for all providers' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(OFFERING_VIEWS))
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

  it('refreshes the data table and provider pages, which list its offerings again', async () => {
    api.getArchivedCaseTypes.mockResolvedValue([archivedHip])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Archived case types (1)' }))
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'Restore Hip Pain' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(OFFERING_VIEWS))
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
