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
vi.mock('../../src/lib/api/providers', () => ({ getProviders: orgApi.getProviders }))
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
