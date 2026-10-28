import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Question } from '../../src/types/database'

/**
 * Three Questions-page bugs found clicking through the admin before launch:
 *
 * 1. The "Location Selector" / "Preferred Provider" system cards created a
 *    new question on every click, with no check for one already in the flow,
 *    so one stray click put a second location question into the live widget.
 * 2. The Add Question wizard saved a location question's filter as
 *    `locationFilter` / `locationIds`, but the widget reads `scope` /
 *    `location_ids` — "specific locations" set there was silently ignored.
 * 3. The entry question's preview showed "Option A / Option B" placeholders
 *    instead of the org's case types.
 */

const questionsApi = vi.hoisted(() => ({
  archiveQuestion: vi.fn(),
  createQuestion: vi.fn(),
  ensureEntryQuestion: vi.fn(),
  getNextOrderRank: vi.fn(),
  getQuestions: vi.fn(),
  reorderQuestions: vi.fn(),
  updateQuestion: vi.fn(),
}))
vi.mock('../../src/lib/api/questions', () => questionsApi)

vi.mock('../../src/lib/api/locations', () => ({
  getLocations: vi.fn().mockResolvedValue([
    { id: 'l1', name: 'Towson' },
    { id: 'l2', name: 'Bel Air' },
  ]),
}))
vi.mock('../../src/lib/api/constraints', () => ({ getConstraints: vi.fn().mockResolvedValue([]) }))
vi.mock('../../src/lib/api/caseTypes', () => ({
  getCaseTypes: vi.fn().mockResolvedValue([
    { id: 'ct1', name: 'Knee' },
    { id: 'ct2', name: 'Shoulder' },
  ]),
}))
vi.mock('../../src/components/testing/LogicTester', () => ({ default: () => null }))
vi.mock('../../src/components/ui/toastStore', () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }),
}))

import QuestionsPage from '../../src/pages/questions/QuestionsPage'
import { useAuthStore } from '../../src/stores/authStore'

const question = (over: Partial<Question>): Question =>
  ({
    id: over.question_type ?? 'q',
    org_id: 'org1',
    question_text: 'Q',
    subtext: null,
    question_type: 'clinical',
    input_type: 'buttons',
    constraint_id: null,
    required: true,
    order_rank: 0,
    system_config: {},
    is_archived: false,
    created_at: '',
    updated_at: '',
    ...over,
  }) as Question

const entry = question({ id: 'entry', question_type: 'entry', question_text: 'What are you seeing us for today?' })
const location = question({ id: 'loc', question_type: 'location', question_text: 'Which location?', order_rank: 1 })
const provider = question({ id: 'prov', question_type: 'provider', question_text: 'Know who?', order_rank: 2 })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <QuestionsPage />
    </QueryClientProvider>,
  )
}

const card = (name: RegExp) => screen.getByRole('button', { name })

describe('QuestionsPage system questions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ org: { id: 'org1', name: 'TOA' } as never })
    questionsApi.ensureEntryQuestion.mockResolvedValue(undefined)
    questionsApi.getNextOrderRank.mockResolvedValue(3)
    questionsApi.createQuestion.mockResolvedValue({ error: null })
  })

  it('disables a system card whose question is already in the flow, so it cannot add a duplicate', async () => {
    questionsApi.getQuestions.mockResolvedValue([entry, location, provider])
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Which location?')
    const locationCard = card(/location selector/i)
    const providerCard = card(/preferred provider/i)
    expect(locationCard).toBeDisabled()
    expect(providerCard).toBeDisabled()
    expect(locationCard).toHaveTextContent('Already in your flow')

    await user.click(locationCard)
    await user.click(providerCard)
    expect(questionsApi.createQuestion).not.toHaveBeenCalled()
  })

  it('still adds a system question the flow does not have yet', async () => {
    questionsApi.getQuestions.mockResolvedValue([entry])
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('What are you seeing us for today?')
    await waitFor(() => expect(card(/location selector/i)).toBeEnabled())
    await user.click(card(/location selector/i))

    await waitFor(() =>
      expect(questionsApi.createQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ question_type: 'location', system_config: { scope: 'all', location_ids: [] } }),
      ),
    )
  })

  it('also blocks the duplicate types in the Add Question wizard', async () => {
    questionsApi.getQuestions.mockResolvedValue([entry, location])
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Which location?')
    await user.click(screen.getByRole('button', { name: /^add question$/i }))
    const wizardChoices = screen.getAllByRole('button', { name: /location selector/i })
    // [0] is the page's system card, [1] the wizard's type choice.
    expect(wizardChoices[1]).toBeDisabled()
    expect(screen.getAllByRole('button', { name: /preferred provider/i })[1]).toBeEnabled()
  })

  it('saves a wizard-made location filter under the keys the widget reads', async () => {
    questionsApi.getQuestions.mockResolvedValue([entry])
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('What are you seeing us for today?')
    await user.click(screen.getByRole('button', { name: /^add question$/i }))
    await user.click(screen.getAllByRole('button', { name: /location selector/i })[1])
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText('Specific locations'))
    await user.click(screen.getByLabelText('Bel Air'))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: 'Save Question' }))

    await waitFor(() =>
      expect(questionsApi.createQuestion).toHaveBeenCalledWith(
        expect.objectContaining({
          question_type: 'location',
          system_config: { scope: 'specific', location_ids: ['l2'] },
        }),
      ),
    )
  })

  it("previews the entry question with the org's case types, not placeholders", async () => {
    questionsApi.getQuestions.mockResolvedValue([entry])
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('What are you seeing us for today?')
    await user.click(screen.getAllByRole('button', { name: 'Preview' })[0])
    const preview = screen.getByText('Question Preview').closest('div')!.parentElement!
    await waitFor(() => expect(within(preview).getByText('Knee')).toBeInTheDocument())
    expect(within(preview).getByText('Shoulder')).toBeInTheDocument()
    expect(within(preview).queryByText('Option A')).not.toBeInTheDocument()
  })
})
