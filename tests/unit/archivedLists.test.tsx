import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Every archivable thing has the same way back: a collapsed "Archived …" list
 * under its page with a Restore button per row. Case types had one; providers,
 * constraints, locations and questions did not, so archiving them was a
 * one-way trip.
 */

const providersApi = vi.hoisted(() => ({ getArchivedProviders: vi.fn(), restoreProvider: vi.fn() }))
const constraintsApi = vi.hoisted(() => ({ getArchivedConstraints: vi.fn(), restoreConstraint: vi.fn() }))
const locationsApi = vi.hoisted(() => ({ getArchivedLocations: vi.fn(), restoreLocation: vi.fn() }))
const questionsApi = vi.hoisted(() => ({ getArchivedQuestions: vi.fn(), restoreQuestion: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))

vi.mock('../../src/lib/api/providers', () => providersApi)
vi.mock('../../src/lib/api/constraints', () => constraintsApi)
vi.mock('../../src/lib/api/locations', () => locationsApi)
vi.mock('../../src/lib/api/questions', () => questionsApi)
vi.mock('../../src/components/ui/toastStore', () => ({ useToast: () => ({ toast }) }))

import ArchivedConstraints from '../../src/pages/constraints/ArchivedConstraints'
import ArchivedLocations from '../../src/pages/locations/ArchivedLocations'
import ArchivedProviders from '../../src/pages/providers/ArchivedProviders'
import ArchivedQuestions from '../../src/pages/questions/ArchivedQuestions'
import { useAuthStore } from '../../src/stores/authStore'

let client: QueryClient

function renderList(element: ReactElement) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

const CASES = [
  {
    label: 'providers',
    element: <ArchivedProviders />,
    api: providersApi.getArchivedProviders,
    restore: providersApi.restoreProvider,
    item: { id: 'p1', org_id: 'org1', name: 'Dr. Adams' },
    name: 'Dr. Adams',
    restoredKeys: [['providers', 'org1'], ['provider'], ['data-table-offerings', 'org1']],
  },
  {
    label: 'constraints',
    element: <ArchivedConstraints />,
    api: constraintsApi.getArchivedConstraints,
    restore: constraintsApi.restoreConstraint,
    item: { id: 'c1', org_id: 'org1', name: 'Sports Only' },
    name: 'Sports Only',
    restoredKeys: [['constraints-with-counts', 'org1'], ['constraints', 'org1']],
  },
  {
    label: 'locations',
    element: <ArchivedLocations />,
    api: locationsApi.getArchivedLocations,
    restore: locationsApi.restoreLocation,
    item: { id: 'l1', org_id: 'org1', name: 'Rosedale' },
    name: 'Rosedale',
    restoredKeys: [['locations-with-counts', 'org1'], ['locations', 'org1'], ['data-table-offerings', 'org1']],
  },
] as const

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    org: { id: 'org1', name: 'Test Org' } as never,
    user: { id: 'u1', org_id: 'org1', name: 'Tester', email: 't@example.com' } as never,
  })
})

describe.each(CASES)('Archived $label', ({ label, element, api, restore, item, name, restoredKeys }) => {
  it('is hidden when nothing is archived', async () => {
    api.mockResolvedValue([])
    renderList(element)

    await waitFor(() => expect(api).toHaveBeenCalledWith('org1'))
    expect(screen.queryByRole('button', { name: /^archived/i })).not.toBeInTheDocument()
  })

  it('lists what is archived, collapsed until opened', async () => {
    api.mockResolvedValue([item])
    const user = userEvent.setup()
    renderList(element)

    const toggle = await screen.findByRole('button', { name: `Archived ${label} (1)` })
    expect(screen.queryByText(name)).not.toBeInTheDocument()
    await user.click(toggle)

    expect(screen.getByText(name)).toBeInTheDocument()
  })

  it('restores one, refreshing everything that shows it again', async () => {
    api.mockResolvedValue([item])
    restore.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderList(element)
    await user.click(await screen.findByRole('button', { name: `Archived ${label} (1)` }))
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: `Restore ${name}` }))

    await waitFor(() => expect(restore).toHaveBeenCalledWith(item.id))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(`${name} restored`))
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
    expect(keys).toEqual(expect.arrayContaining(restoredKeys.map((key) => [...key])))
  })

  it('reports a failed restore and leaves it archived', async () => {
    api.mockResolvedValue([item])
    restore.mockResolvedValue({ error: 'network down' })
    const user = userEvent.setup()
    renderList(element)
    await user.click(await screen.findByRole('button', { name: `Archived ${label} (1)` }))

    await user.click(screen.getByRole('button', { name: `Restore ${name}` }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('network down'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: `Restore ${name}` })).toBeEnabled()
  })
})

describe('Archived questions', () => {
  const question = {
    id: 'q1',
    org_id: 'org1',
    question_text: 'Which location works best for you?',
    question_type: 'location',
  }

  it('lists archived questions by their text and marks system ones', async () => {
    questionsApi.getArchivedQuestions.mockResolvedValue([question])
    const user = userEvent.setup()
    renderList(<ArchivedQuestions />)

    await user.click(await screen.findByRole('button', { name: 'Archived questions (1)' }))

    expect(screen.getByText('Which location works best for you?')).toBeInTheDocument()
    expect(screen.getByText('Location')).toBeInTheDocument()
  })

  it('restores a question at the end of the flow', async () => {
    questionsApi.getArchivedQuestions.mockResolvedValue([question])
    questionsApi.restoreQuestion.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderList(<ArchivedQuestions />)
    await user.click(await screen.findByRole('button', { name: 'Archived questions (1)' }))
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'Restore Which location works best for you?' }))

    await waitFor(() => expect(questionsApi.restoreQuestion).toHaveBeenCalledWith(question))
    expect(toast.success).toHaveBeenCalledWith('Question restored at the end of the flow')
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toContainEqual(['questions', 'org1'])
  })

  it('says why when the flow already has that kind of question', async () => {
    questionsApi.getArchivedQuestions.mockResolvedValue([question])
    questionsApi.restoreQuestion.mockResolvedValue({
      error: 'The flow already has a Location question. The widget asks it only once.',
    })
    const user = userEvent.setup()
    renderList(<ArchivedQuestions />)
    await user.click(await screen.findByRole('button', { name: 'Archived questions (1)' }))

    await user.click(screen.getByRole('button', { name: 'Restore Which location works best for you?' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/already has a Location question/)))
  })
})
