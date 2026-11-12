import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Provider } from '../../src/types/database'

/**
 * Drives the wizard the way a user does — upload, map, resolve, preview,
 * import — and checks what it hands to executeImportRun.
 *
 * The engine has its own tests; what matters here is that the choices made on
 * screen actually reach it. A conflict resolved as "merge" that arrives as no
 * conflict at all silently duplicates a provider rather than updating it, and
 * nothing on screen looks wrong when it happens.
 */

const parse = vi.hoisted(() => ({ parseFile: vi.fn() }))
const exec = vi.hoisted(() => ({ executeImportRun: vi.fn() }))
const orgApi = vi.hoisted(() => ({
  getLocations: vi.fn(),
  getConstraints: vi.fn(),
  getProviders: vi.fn(),
  getArchivedProviders: vi.fn(),
  getCaseTypes: vi.fn(),
  getCategories: vi.fn(),
}))

vi.mock('../../src/lib/parsers/fileParser', () => parse)
vi.mock('../../src/lib/import/importExecution', async (importOriginal) => {
  // Keep the real detectConflicts: the point of these tests is whether its
  // output survives the trip through the wizard.
  const actual = await importOriginal<typeof import('../../src/lib/import/importExecution')>()
  return { ...actual, executeImportRun: exec.executeImportRun }
})
vi.mock('../../src/lib/api/locations', () => ({ getLocations: orgApi.getLocations }))
vi.mock('../../src/lib/api/constraints', () => ({ getConstraints: orgApi.getConstraints }))
vi.mock('../../src/lib/api/providers', () => ({
  getProviders: orgApi.getProviders,
  getArchivedProviders: orgApi.getArchivedProviders,
}))
vi.mock('../../src/lib/api/caseTypes', () => ({ getCaseTypes: orgApi.getCaseTypes }))
vi.mock('../../src/lib/api/categories', () => ({ getCategories: orgApi.getCategories }))
vi.mock('../../src/components/ui/toastStore', () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }),
}))

import ImportWizard from '../../src/components/import/ImportWizard'

const existing: Provider = {
  id: 'existing-p1',
  org_id: 'org1',
  name: 'Dr. Jane Smith',
  normalized_name: 'dr jane smith',
  category_ids: [],
  is_archived: false,
  created_at: '',
  updated_at: '',
} as Provider

const HEADERS = ['provider', 'Case type']
const ROWS = [{ provider: 'Dr. Jane Smith', 'Case type': 'Knee' }]

function renderWizard() {
  return render(
    <ImportWizard isOpen onClose={vi.fn()} onComplete={vi.fn()} orgId="org1" />,
  )
}

async function uploadFile(user: ReturnType<typeof userEvent.setup>) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await user.upload(input, new File(['x'], 'providers.xlsx', { type: 'application/vnd.ms-excel' }))
  await screen.findByRole('button', { name: /continue/i })
}

/** Picks the role for a column on the mapping step. */
async function mapColumn(
  user: ReturnType<typeof userEvent.setup>,
  header: string,
  optionLabel: string,
) {
  const label = screen.getByText(header)
  const rowEl = label.closest('div[class*="grid"], tr, div') as HTMLElement
  const select = within(rowEl).getAllByRole('combobox')[0]
  await user.selectOptions(select, optionLabel)
}

beforeEach(() => {
  vi.clearAllMocks()
  parse.parseFile.mockResolvedValue({
    headers: HEADERS,
    rows: ROWS,
    errors: [],
    rowCount: ROWS.length,
  })
  orgApi.getLocations.mockResolvedValue([])
  orgApi.getConstraints.mockResolvedValue([])
  orgApi.getCaseTypes.mockResolvedValue([])
  orgApi.getCategories.mockResolvedValue([])
  orgApi.getProviders.mockResolvedValue([existing])
  orgApi.getArchivedProviders.mockResolvedValue([])
  exec.executeImportRun.mockResolvedValue({
    providersCreated: 0,
    providersUpdated: 1,
    offeringsUpserted: 1,
    newCaseTypesCount: 0,
    newCategoriesCount: 0,
  })
})

describe('ImportWizard conflict handling', () => {
  it('passes the resolved conflicts through to the import', async () => {
    const user = userEvent.setup()
    renderWizard()
    await waitFor(() => expect(orgApi.getProviders).toHaveBeenCalled())

    // Step 1 -> 2
    await uploadFile(user)
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // Step 2: map the provider column, then continue to conflicts.
    await mapColumn(user, 'provider', 'Provider Name')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // Step 3: the existing provider must be surfaced as a conflict.
    const mergeRadio = await screen.findByRole('radio', { name: /^Merge/i })
    await user.click(mergeRadio)

    // Step 3 -> 4 (preview), then run the import.
    await user.click(screen.getByRole('button', { name: /continue/i }))
    const importBtn = await screen.findByRole('button', { name: /import|confirm|run/i })
    await user.click(importBtn)

    await waitFor(() => expect(exec.executeImportRun).toHaveBeenCalled())

    const passed = exec.executeImportRun.mock.calls[0][0]
    // The whole point: the conflict the user just resolved must still be here.
    // If it arrives empty, executeImportRun treats the row as a brand-new
    // provider and creates a duplicate of Dr. Jane Smith.
    expect(passed.conflicts).toHaveLength(1)
    expect(passed.conflicts[0].existingProvider.id).toBe('existing-p1')
    expect(passed.resolvedConflicts['0']).toBe('merge')
  })
})

describe('ImportWizard closing', () => {
  it('closes on Escape, like clicking the backdrop', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ImportWizard isOpen onClose={onClose} onComplete={vi.fn()} orgId="org1" />)
    await waitFor(() => expect(orgApi.getProviders).toHaveBeenCalled())

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ImportWizard misspelled names', () => {
  const rows = [
    { provider: 'Dr. New Person', 'Case type': 'Shoulders', category: 'Sports Medincine, Podiatry' },
  ]

  beforeEach(() => {
    parse.parseFile.mockResolvedValue({
      headers: ['provider', 'Case type', 'category'],
      rows,
      errors: [],
      rowCount: rows.length,
    })
    orgApi.getProviders.mockResolvedValue([])
    orgApi.getCaseTypes.mockResolvedValue([{ id: 'ct1', name: 'Shoulder' }])
    orgApi.getCategories.mockResolvedValue([{ id: 'cat1', name: 'Sports Medicine' }])
  })

  async function toNamesStep(user: ReturnType<typeof userEvent.setup>) {
    renderWizard()
    await waitFor(() => expect(orgApi.getProviders).toHaveBeenCalled())
    await uploadFile(user)
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await mapColumn(user, 'provider', 'Provider Name')
    await mapColumn(user, 'Case type', 'Case Type')
    await mapColumn(user, 'category', 'Category')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await screen.findByText('These names look misspelled')
  }

  async function runImport(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(await screen.findByRole('button', { name: /import|confirm|run/i }))
    await waitFor(() => expect(exec.executeImportRun).toHaveBeenCalled())
    return exec.executeImportRun.mock.calls[0][0]
  }

  it('offers to match near-miss case types and categories, and imports the matched names', async () => {
    const user = userEvent.setup()
    await toNamesStep(user)

    expect(screen.getByRole('checkbox', { name: /“Shoulders”.*“Shoulder”/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /“Sports Medincine”.*“Sports Medicine”/ })).toBeChecked()
    // "Podiatry" is simply new, so it is not flagged.
    expect(screen.queryByText(/“Podiatry”/)).not.toBeInTheDocument()

    const passed = await runImport(user)

    expect(passed.rows).toEqual([
      { provider: 'Dr. New Person', 'Case type': 'Shoulder', category: 'Sports Medicine, Podiatry' },
    ])
    // The file's own rows are not changed, only what is sent.
    expect(rows[0]['Case type']).toBe('Shoulders')
  })

  it('keeps the file’s spelling for a name the user unticks', async () => {
    const user = userEvent.setup()
    await toNamesStep(user)

    await user.click(screen.getByRole('checkbox', { name: /“Sports Medincine”/ }))
    const passed = await runImport(user)

    expect(passed.rows[0]).toMatchObject({ 'Case type': 'Shoulder', category: 'Sports Medincine, Podiatry' })
  })
})

describe('ImportWizard archived providers', () => {
  it('matches a row to an archived provider and merges by restoring them', async () => {
    orgApi.getProviders.mockResolvedValue([])
    orgApi.getArchivedProviders.mockResolvedValue([{ ...existing, id: 'archived-p1', is_archived: true }])
    const user = userEvent.setup()
    renderWizard()
    await waitFor(() => expect(orgApi.getArchivedProviders).toHaveBeenCalled())

    await uploadFile(user)
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await mapColumn(user, 'provider', 'Provider Name')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // Without this the row would create a second Dr. Jane Smith beside the archived one.
    expect(await screen.findByText('Archived')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /merge \(restore and update\)/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(await screen.findByRole('button', { name: /import|confirm|run/i }))
    await waitFor(() => expect(exec.executeImportRun).toHaveBeenCalled())

    const passed = exec.executeImportRun.mock.calls[0][0]
    expect(passed.conflicts[0].existingProvider).toMatchObject({ id: 'archived-p1', is_archived: true })
    expect(passed.resolvedConflicts['0']).toBe('merge')
  })

  it('prefers a live provider over an archived one with the same name', async () => {
    orgApi.getArchivedProviders.mockResolvedValue([{ ...existing, id: 'archived-p1', is_archived: true }])
    const user = userEvent.setup()
    renderWizard()
    await waitFor(() => expect(orgApi.getArchivedProviders).toHaveBeenCalled())

    await uploadFile(user)
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await mapColumn(user, 'provider', 'Provider Name')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await user.click(await screen.findByRole('radio', { name: /^Merge \(update existing\)/i }))
    expect(screen.queryByText('Archived')).not.toBeInTheDocument()
  })
})

describe('ImportWizard the same person twice in one file', () => {
  const rows = [
    { provider: 'Dr. Jeffery T. Brodie', 'Case type': 'Knee' },
    { provider: 'Someone Else', 'Case type': 'Hip' },
    { provider: 'Brodie, Jeffery T.', 'Case type': 'Hip' },
  ]

  beforeEach(() => {
    parse.parseFile.mockResolvedValue({ headers: HEADERS, rows, errors: [], rowCount: rows.length })
    orgApi.getProviders.mockResolvedValue([])
  })

  async function toNamesStep(user: ReturnType<typeof userEvent.setup>) {
    renderWizard()
    await waitFor(() => expect(orgApi.getProviders).toHaveBeenCalled())
    await uploadFile(user)
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await mapColumn(user, 'provider', 'Provider Name')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await screen.findByText('These names look misspelled')
  }

  async function runImport(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(await screen.findByRole('button', { name: /import|confirm|run/i }))
    await waitFor(() => expect(exec.executeImportRun).toHaveBeenCalled())
    return exec.executeImportRun.mock.calls[0][0]
  }

  it('offers to treat the later spelling as the first, and imports them as one provider', async () => {
    const user = userEvent.setup()
    await toNamesStep(user)

    expect(screen.getByRole('checkbox', { name: /“Brodie, Jeffery T\.”.*“Dr\. Jeffery T\. Brodie”/ })).toBeChecked()
    expect(screen.getByText('Provider, earlier in this file')).toBeInTheDocument()

    const passed = await runImport(user)

    expect(passed.rows.map((r: Record<string, string>) => r.provider)).toEqual([
      'Dr. Jeffery T. Brodie',
      'Someone Else',
      'Dr. Jeffery T. Brodie',
    ])
  })

  it('keeps them separate when the admin unticks it', async () => {
    const user = userEvent.setup()
    await toNamesStep(user)

    await user.click(screen.getByRole('checkbox', { name: /“Brodie, Jeffery T\.”/ }))
    const passed = await runImport(user)

    expect(passed.rows[2].provider).toBe('Brodie, Jeffery T.')
  })
})

describe('ImportWizard preview counts', () => {
  /** The number shown under a preview tile's label. */
  const tile = (label: string) => screen.getByText(label).parentElement?.querySelector('p:last-child')?.textContent

  async function toPreview(user: ReturnType<typeof userEvent.setup>, { resolveMerge = false } = {}) {
    renderWizard()
    await waitFor(() => expect(orgApi.getProviders).toHaveBeenCalled())
    await uploadFile(user)
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await mapColumn(user, 'provider', 'Provider Name')
    await mapColumn(user, 'Case type', 'Case Type')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    if (resolveMerge) {
      for (const radio of await screen.findAllByRole('radio', { name: /^Merge/i })) await user.click(radio)
    } else {
      await screen.findByText(/no duplicates detected/i)
    }
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await screen.findByText('Preview import')
  }

  it('counts each new provider once, however many case types they are listed under', async () => {
    const rows = [
      { provider: 'Dr. Amy Adams', 'Case type': 'Knee' },
      { provider: 'Dr. Amy Adams', 'Case type': 'Hip' },
      { provider: 'dr amy adams', 'Case type': 'Shoulder' },
      { provider: 'Bob Brown', 'Case type': 'Knee' },
    ]
    parse.parseFile.mockResolvedValue({ headers: HEADERS, rows, errors: [], rowCount: rows.length })
    orgApi.getProviders.mockResolvedValue([])
    const user = userEvent.setup()
    await toPreview(user)

    expect(tile('New providers')).toBe('2')
    expect(tile('Updated providers')).toBe('0')
    // Every row still becomes an offering.
    expect(tile('Total offerings')).toBe('4')
  })

  it('counts an existing provider once when several rows merge into them', async () => {
    const rows = [
      { provider: 'Dr. Jane Smith', 'Case type': 'Knee' },
      { provider: 'Dr. Jane Smith', 'Case type': 'Hip' },
    ]
    parse.parseFile.mockResolvedValue({ headers: HEADERS, rows, errors: [], rowCount: rows.length })
    const user = userEvent.setup()
    await toPreview(user, { resolveMerge: true })

    expect(tile('Updated providers')).toBe('1')
    expect(tile('New providers')).toBe('0')
    expect(tile('Total offerings')).toBe('2')
  })

  it('does not count skipped rows as providers', async () => {
    const rows = [
      { provider: 'Dr. Jane Smith', 'Case type': 'Knee' },
      { provider: 'Bob Brown', 'Case type': 'Hip' },
      { provider: 'Bob Brown', 'Case type': 'Knee' },
    ]
    parse.parseFile.mockResolvedValue({ headers: HEADERS, rows, errors: [], rowCount: rows.length })
    const user = userEvent.setup()
    renderWizard()
    await waitFor(() => expect(orgApi.getProviders).toHaveBeenCalled())
    await uploadFile(user)
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await mapColumn(user, 'provider', 'Provider Name')
    await mapColumn(user, 'Case type', 'Case Type')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(await screen.findByRole('radio', { name: /^Skip row/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await screen.findByText('Preview import')

    expect(tile('New providers')).toBe('1')
    expect(tile('Skipped')).toBe('1')
    expect(tile('Total offerings')).toBe('2')
  })
})

describe('ImportWizard self-scheduling links', () => {
  const HEADERS_WITH_LINKS = ['provider', 'Case type', 'Request link', 'Self link']
  const ROWS_WITH_LINKS = [
    { provider: 'Dr. Jane Smith', 'Case type': 'Knee', 'Request link': 'https://book.example/jane', 'Self link': 'https://cal.example/jane' },
  ]

  /** The row's mapping controls: the role, then (for a per-location role) its location. */
  const rowControls = (header: string) =>
    within(screen.getByText(header).closest('div[class*="grid"], tr, div') as HTMLElement).getAllByRole('combobox')

  async function openMapping(user: ReturnType<typeof userEvent.setup>) {
    parse.parseFile.mockResolvedValue({
      headers: HEADERS_WITH_LINKS,
      rows: ROWS_WITH_LINKS,
      errors: [],
      rowCount: ROWS_WITH_LINKS.length,
    })
    renderWizard()
    await waitFor(() => expect(orgApi.getProviders).toHaveBeenCalled())
    await uploadFile(user)
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await mapColumn(user, 'provider', 'Provider Name')
  }

  it('offers it next to the appointment request link and the phone', async () => {
    const user = userEvent.setup()
    await openMapping(user)

    const options = within(rowControls('Self link')[0]).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(expect.arrayContaining(['Appointment Request Link', 'Self-Scheduling Link', 'Phone Number']))
  })

  it('asks which location it is for, like the other per-location columns', async () => {
    const user = userEvent.setup()
    orgApi.getLocations.mockResolvedValue([{ id: 'loc1', name: 'Towson', org_id: 'org1', is_archived: false }])
    await openMapping(user)
    expect(rowControls('Self link')).toHaveLength(1)

    await mapColumn(user, 'Self link', 'Self-Scheduling Link')

    const controls = rowControls('Self link')
    expect(controls).toHaveLength(2)
    expect(within(controls[1]).getByRole('option', { name: 'All locations' })).toBeInTheDocument()
    expect(within(controls[1]).getByRole('option', { name: 'Towson' })).toBeInTheDocument()
  })

  it('stops asking for a location when the column is set to something else', async () => {
    const user = userEvent.setup()
    await openMapping(user)
    await mapColumn(user, 'Self link', 'Self-Scheduling Link')
    expect(rowControls('Self link')).toHaveLength(2)

    await mapColumn(user, 'Self link', 'Ignore this column')
    expect(rowControls('Self link')).toHaveLength(1)
  })

  it('hands the import the self-scheduling column with its location', async () => {
    const user = userEvent.setup()
    await openMapping(user)
    await mapColumn(user, 'Request link', 'Appointment Request Link')
    await user.selectOptions(rowControls('Request link')[1], 'All locations')
    await mapColumn(user, 'Self link', 'Self-Scheduling Link')
    await user.selectOptions(rowControls('Self link')[1], 'All locations')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await user.click(await screen.findByRole('radio', { name: /^Merge/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(await screen.findByRole('button', { name: /import|confirm|run/i }))

    await waitFor(() => expect(exec.executeImportRun).toHaveBeenCalled())
    const { mappings } = exec.executeImportRun.mock.calls[0][0]
    expect(mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ excelHeader: 'Request link', role: 'booking_link', locationScope: 'all' }),
        expect.objectContaining({ excelHeader: 'Self link', role: 'self_schedule_link', locationScope: 'all' }),
      ]),
    )
  })
})
