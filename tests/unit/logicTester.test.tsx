import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaseType, Constraint, Provider, Question } from '../../src/types/database'

/**
 * Covers LogicTester's flow after moving session start, auto-skip, and the
 * questions -> results transition out of reactive effects and into the paths
 * that actually move the flow.
 *
 * Rendered under StrictMode deliberately: session start now runs during render,
 * so a non-idempotent update would show up here as duplicated log lines.
 */

const api = vi.hoisted(() => ({
  getQuestions: vi.fn(),
  getProviders: vi.fn(),
  getDataTableOfferings: vi.fn(),
  getCaseTypes: vi.fn(),
  getCategories: vi.fn(),
  getLocations: vi.fn(),
  getConstraints: vi.fn(),
}))

vi.mock('../../src/lib/api/questions', () => ({ getQuestions: api.getQuestions }))
vi.mock('../../src/lib/api/providers', () => ({ getProviders: api.getProviders }))
vi.mock('../../src/lib/api/dataTable', () => ({ getDataTableOfferings: api.getDataTableOfferings }))
vi.mock('../../src/lib/api/caseTypes', () => ({ getCaseTypes: api.getCaseTypes }))
vi.mock('../../src/lib/api/categories', () => ({ getCategories: api.getCategories }))
vi.mock('../../src/lib/api/locations', () => ({ getLocations: api.getLocations }))
vi.mock('../../src/lib/api/constraints', () => ({ getConstraints: api.getConstraints }))

import LogicTester from '../../src/components/testing/LogicTester'
import { useAuthStore } from '../../src/stores/authStore'

const caseType: CaseType = {
  id: 'ct1',
  org_id: 'org1',
  name: 'Knee Pain',
  order_rank: 0,
  is_archived: false,
  created_at: '',
  updated_at: '',
} as CaseType

const provider: Provider = {
  id: 'p1',
  org_id: 'org1',
  name: 'Dr. Ada Reyes',
  normalized_name: null,
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
}

/** A constraint no offering carries data for — every question on it is skippable. */
const orphanConstraint: Constraint = {
  id: 'c-orphan',
  org_id: 'org1',
  name: 'Orphan',
  type: 'binary',
  mapped_key: 'never_mapped',
  secondary_mapped_key: null,
  min_allowed_value: null,
  max_allowed_value: null,
  yes_label: 'Yes',
  no_label: 'No',
  yes_maps_to: '1',
  no_maps_to: '0',
  sort_order: 0,
  is_archived: false,
  created_at: '',
  updated_at: '',
}

function question(over: Partial<Question>): Question {
  return {
    id: 'q',
    org_id: 'org1',
    question_text: 'Question',
    subtext: null,
    question_type: 'clinical',
    input_type: 'buttons',
    constraint_id: null,
    required: false,
    order_rank: 0,
    system_config: {},
    is_archived: false,
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function renderTester() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <LogicTester onClose={() => {}} orgId="org1" />
      </QueryClientProvider>
    </StrictMode>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ org: { id: 'org1', name: 'Org' } as never })

  api.getQuestions.mockResolvedValue([
    question({ id: 'q-entry', question_type: 'entry', question_text: 'What brings you in?', order_rank: 0 }),
    question({ id: 'q-skip', constraint_id: 'c-orphan', question_text: 'Skippable question', order_rank: 1 }),
  ])
  api.getProviders.mockResolvedValue([provider])
  api.getDataTableOfferings.mockResolvedValue([
    {
      id: 'o1',
      provider_id: 'p1',
      case_type_id: 'ct1',
      org_id: 'org1',
      location_ids: [],
      constraints: {},
      is_archived: false,
      created_at: '',
      updated_at: '',
      providers: { name: 'Dr. Ada Reyes', category_ids: [], image_url: null },
    },
  ])
  api.getCaseTypes.mockResolvedValue([caseType])
  api.getCategories.mockResolvedValue([])
  api.getLocations.mockResolvedValue([])
  api.getConstraints.mockResolvedValue([orphanConstraint])
})

describe('LogicTester flow', () => {
  it('logs session start exactly once, despite StrictMode double-rendering', async () => {
    renderTester()
    await screen.findByText(/Session started/)
    expect(screen.getAllByText(/Session started/)).toHaveLength(1)
  })

  it('reports the offering count it loaded', async () => {
    renderTester()
    expect(await screen.findByText(/1 total offerings loaded/)).toBeInTheDocument()
  })

  it('shows the entry question first', async () => {
    renderTester()
    expect(await screen.findByText('What brings you in?')).toBeInTheDocument()
  })

  it('auto-skips a clinical question with no backing data and lands on results', async () => {
    const user = userEvent.setup()
    renderTester()
    await screen.findByText('What brings you in?')

    await user.click(screen.getByRole('button', { name: 'Knee Pain' }))

    // The only remaining question maps to a constraint no offering carries, so
    // it must be skipped rather than shown, taking the flow straight to results.
    await waitFor(() => {
      expect(screen.getByText(/Auto-skipped clinical/)).toBeInTheDocument()
    })
    expect(screen.queryByText('Skippable question')).not.toBeInTheDocument()
    expect(screen.getByText(/Question flow complete/)).toBeInTheDocument()
  })

  it('logs each auto-skip once rather than once per render', async () => {
    const user = userEvent.setup()
    renderTester()
    await screen.findByText('What brings you in?')

    await user.click(screen.getByRole('button', { name: 'Knee Pain' }))

    await waitFor(() => {
      expect(screen.getAllByText(/Auto-skipped clinical/)).toHaveLength(1)
    })
    expect(screen.getAllByText(/Question flow complete/)).toHaveLength(1)
  })

  it('resets back to the entry question', async () => {
    const user = userEvent.setup()
    renderTester()
    await screen.findByText('What brings you in?')
    await user.click(screen.getByRole('button', { name: 'Knee Pain' }))
    await waitFor(() => expect(screen.getByText(/Question flow complete/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /reset/i }))

    expect(await screen.findByText('What brings you in?')).toBeInTheDocument()
    expect(screen.getAllByText(/Session started/)).toHaveLength(1)
  })
})

describe('Enter key in the tester, as in the widget', () => {
  const ageConstraint: Constraint = {
    ...orphanConstraint,
    id: 'c-age',
    name: 'Age Range',
    type: 'range',
    mapped_key: 'min_age',
    secondary_mapped_key: 'max_age',
  }

  beforeEach(() => {
    api.getQuestions.mockResolvedValue([
      question({ id: 'q-entry', question_type: 'entry', question_text: 'What brings you in?', order_rank: 0 }),
      question({ id: 'q-age', constraint_id: 'c-age', question_text: 'How old is the patient?', order_rank: 1 }),
    ])
    api.getConstraints.mockResolvedValue([ageConstraint])
    api.getDataTableOfferings.mockResolvedValue([
      {
        id: 'o1',
        provider_id: 'p1',
        case_type_id: 'ct1',
        org_id: 'org1',
        location_ids: [],
        constraints: { min_age: 0, max_age: 99 },
        is_archived: false,
        created_at: '',
        updated_at: '',
        providers: { name: 'Dr. Ada Reyes', category_ids: [], image_url: null },
      },
    ])
  })

  it('submits a typed number, like pressing Next', async () => {
    const user = userEvent.setup()
    renderTester()
    await screen.findByText('What brings you in?')
    await user.click(screen.getByRole('button', { name: 'Knee Pain' }))

    await user.type(await screen.findByPlaceholderText('Enter a number'), '45{Enter}')

    await waitFor(() => expect(screen.getByText(/Question flow complete/)).toBeInTheDocument())
    expect(screen.getByText(/Filter applied: Age Range/)).toBeInTheDocument()
  })

  it('does nothing on Enter in an empty number field, like Next', async () => {
    const user = userEvent.setup()
    renderTester()
    await screen.findByText('What brings you in?')
    await user.click(screen.getByRole('button', { name: 'Knee Pain' }))

    await user.type(await screen.findByPlaceholderText('Enter a number'), '{Enter}')

    expect(screen.getByText('How old is the patient?')).toBeInTheDocument()
    expect(screen.queryByText(/Question flow complete/)).not.toBeInTheDocument()
  })
})
