import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import OfferingModal from '../../src/components/modals/OfferingModal'
import { emptyOfferingDraft } from '../../src/components/modals/offeringDraft'
import type { CaseType, Constraint, Location, Provider } from '../../src/types/database'

/**
 * The shared add/edit offering form. It replaced the Data Table's "+ Add"
 * button, which only ever showed `alert('Add flow coming soon')` — in
 * production — so these pin that the form validates and hands back a
 * complete draft.
 */

const providers = [
  { id: 'p1', name: 'Dr. Adams' },
  { id: 'p2', name: 'Dr. Brodie' },
] as Provider[]
const caseTypes = [
  { id: 'ct1', name: 'Knee' },
  { id: 'ct2', name: 'Hand' },
] as CaseType[]
const locations = [
  { id: 'l1', name: 'Towson' },
  { id: 'l2', name: 'Bel Air' },
] as Location[]
const constraints = [
  { id: 'c1', name: 'Sports Only', type: 'binary', mapped_key: 'sports_only', secondary_mapped_key: null },
  { id: 'c2', name: 'Age Range', type: 'range', mapped_key: 'age_min', secondary_mapped_key: 'age_max' },
] as Constraint[]

function renderModal(props: Partial<Parameters<typeof OfferingModal>[0]> = {}) {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(
    <OfferingModal
      title="Add Offering"
      providers={providers}
      caseTypes={caseTypes}
      locations={locations}
      constraints={constraints}
      initial={emptyOfferingDraft()}
      saving={false}
      error=""
      onCancel={onCancel}
      onSave={onSave}
      {...props}
    />,
  )
  return { onSave, onCancel }
}

describe('OfferingModal', () => {
  it('requires a provider when it offers a provider picker', async () => {
    const user = userEvent.setup()
    const { onSave } = renderModal()
    await user.selectOptions(screen.getByLabelText('Case Type'), 'ct1')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Provider is required')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('requires a case type', async () => {
    const user = userEvent.setup()
    const { onSave } = renderModal()
    await user.selectOptions(screen.getByLabelText('Provider'), 'p1')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Case type is required')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('hands back the provider, case type, locations and constraints that were entered', async () => {
    const user = userEvent.setup()
    const { onSave } = renderModal()
    await user.selectOptions(screen.getByLabelText('Provider'), 'p2')
    await user.selectOptions(screen.getByLabelText('Case Type'), 'ct2')
    await user.click(screen.getByLabelText('Bel Air'))
    await user.click(screen.getByLabelText('Enabled'))
    await user.type(screen.getByPlaceholderText('Min'), '13')
    await user.type(screen.getByPlaceholderText('Max'), '99')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith({
      providerId: 'p2',
      caseTypeId: 'ct2',
      locationIds: ['l2'],
      constraints: { sports_only: 1, age_min: '13', age_max: '99' },
    })
  })

  it('has no provider picker when the provider is fixed, as on a provider profile', async () => {
    const user = userEvent.setup()
    const { onSave } = renderModal({ providers: undefined, initial: emptyOfferingDraft('p1') })
    expect(screen.queryByLabelText('Provider')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Case Type'), 'ct1')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'p1', caseTypeId: 'ct1' }))
  })

  it('seeds an edit from the existing offering', () => {
    renderModal({
      providers: undefined,
      initial: { providerId: 'p1', caseTypeId: 'ct1', locationIds: ['l1'], constraints: { age_min: 0, age_max: 200 } },
    })
    expect(screen.getByLabelText('Case Type')).toHaveValue('ct1')
    expect(screen.getByLabelText('Towson')).toBeChecked()
    expect(screen.getByLabelText('Bel Air')).not.toBeChecked()
    expect(screen.getByPlaceholderText('Max')).toHaveValue(200)
  })

  it('shows a save error from the server', () => {
    renderModal({ error: 'duplicate key value' })
    expect(screen.getByText('duplicate key value')).toBeInTheDocument()
  })
})
