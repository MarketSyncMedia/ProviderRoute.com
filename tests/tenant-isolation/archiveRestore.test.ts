import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createTestHarness, type TestHarness } from './fixtures'

/**
 * Archiving a location, provider, constraint or question is undoable, against
 * the real tables as a signed-in admin. A location in particular used to be
 * stripped from every offering and its provider booking details deleted when
 * archived, so there was nothing to restore.
 */

const db = vi.hoisted(() => ({ client: null as SupabaseClient | null }))

vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.client
  },
}))

import { archiveLocation, getArchivedLocations, getLocations, restoreLocation } from '../../src/lib/api/locations'
import { getProviderLocations, upsertProviderLocation } from '../../src/lib/api/providerLocations'
import { archiveProvider, getArchivedProviders, getProviders, restoreProvider } from '../../src/lib/api/providers'
import { archiveQuestion, getArchivedQuestions, getQuestions, restoreQuestion } from '../../src/lib/api/questions'
import { archiveConstraint, getArchivedConstraints, getConstraints, restoreConstraint } from '../../src/lib/api/constraints'

let harness: TestHarness
const ids = {} as Record<'location' | 'provider' | 'caseType' | 'offering' | 'constraint', string>

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.client!.from(table).insert(row).select('id').single()
  if (error || !data) throw new Error(`Failed to seed ${table}: ${error?.message}`)
  return data.id as string
}

const idsOf = (rows: Array<{ id: string }>) => rows.map((r) => r.id)

beforeAll(async () => {
  harness = await createTestHarness()
  const { client, orgId } = harness.tenantA
  db.client = client

  ids.location = await insert('locations', { org_id: orgId, name: 'Restore Test Location' })
  ids.caseType = await insert('case_types', { org_id: orgId, name: 'Restore Test Case Type' })
  ids.provider = await insert('providers', {
    org_id: orgId,
    name: 'Restore Test Provider',
    normalized_name: 'restore test provider',
    category_ids: [],
  })
  ids.offering = await insert('offerings', {
    org_id: orgId,
    provider_id: ids.provider,
    case_type_id: ids.caseType,
    location_ids: [ids.location],
    constraints: {},
  })
  ids.constraint = await insert('constraints', {
    org_id: orgId,
    name: 'Restore Test Constraint',
    type: 'binary',
    mapped_key: 'restore_test',
    sort_order: 0,
  })
  expect((await upsertProviderLocation(ids.provider, ids.location, 'https://book.example/restore', '4105550100')).error).toBeNull()
}, 120_000)

afterAll(async () => {
  db.client = null
  if (harness) {
    // The saved booking details go before the provider: their audit trigger
    // looks the provider up by id, so a cascade from its delete would raise.
    await harness.service.from('provider_locations').delete().eq('provider_id', ids.provider)
    await harness.service.from('providers').delete().eq('id', ids.provider)
    await harness.cleanup()
  }
}, 120_000)

describe('archiving a location', () => {
  it('hides it but keeps the offerings and booking details, so restoring brings them back', async () => {
    const { orgId } = harness.tenantA

    expect((await archiveLocation(ids.location)).error).toBeNull()

    expect(idsOf(await getLocations(orgId))).not.toContain(ids.location)
    expect(idsOf(await getArchivedLocations(orgId))).toContain(ids.location)
    const { data: offering } = await db.client!.from('offerings').select('location_ids').eq('id', ids.offering).single()
    expect(offering?.location_ids).toEqual([ids.location])
    expect(await getProviderLocations(ids.provider)).toEqual([
      expect.objectContaining({ location_id: ids.location, booking_link: 'https://book.example/restore' }),
    ])

    expect((await restoreLocation(ids.location)).error).toBeNull()

    expect(idsOf(await getLocations(orgId))).toContain(ids.location)
    expect(idsOf(await getArchivedLocations(orgId))).not.toContain(ids.location)
  })
})

describe('archiving a provider', () => {
  it('can be undone', async () => {
    const { orgId } = harness.tenantA

    expect((await archiveProvider(ids.provider)).error).toBeNull()
    expect(idsOf(await getProviders(orgId))).not.toContain(ids.provider)
    expect(idsOf(await getArchivedProviders(orgId))).toContain(ids.provider)

    expect((await restoreProvider(ids.provider)).error).toBeNull()
    expect(idsOf(await getProviders(orgId))).toContain(ids.provider)
    expect(idsOf(await getArchivedProviders(orgId))).not.toContain(ids.provider)
  })
})

describe('archiving a constraint', () => {
  it('can be undone', async () => {
    const { orgId } = harness.tenantA

    expect((await archiveConstraint(ids.constraint)).error).toBeNull()
    expect(idsOf(await getConstraints(orgId))).not.toContain(ids.constraint)
    expect(idsOf(await getArchivedConstraints(orgId))).toContain(ids.constraint)

    expect((await restoreConstraint(ids.constraint)).error).toBeNull()
    expect(idsOf(await getConstraints(orgId))).toContain(ids.constraint)
  })
})

describe('archiving a question', () => {
  it('restores at the end of the flow, and not a second location question', async () => {
    const { orgId } = harness.tenantA
    const question = (text: string, type: string, rank: number) =>
      insert('questions', {
        org_id: orgId,
        question_text: text,
        question_type: type,
        input_type: 'buttons',
        required: true,
        order_rank: rank,
        system_config: {},
      })
    const first = await question('Restore test first?', 'clinical', 1)
    const archivedLocationQuestion = await question('Restore test where?', 'location', 2)
    expect((await archiveQuestion(archivedLocationQuestion)).error).toBeNull()
    const liveLocationQuestion = await question('Restore test where, again?', 'location', 3)

    expect(idsOf(await getArchivedQuestions(orgId))).toContain(archivedLocationQuestion)
    const refused = await restoreQuestion({ id: archivedLocationQuestion, org_id: orgId, question_type: 'location' })
    expect(refused.error).toMatch(/already has a Location question/)

    expect((await archiveQuestion(liveLocationQuestion)).error).toBeNull()
    expect(await restoreQuestion({ id: archivedLocationQuestion, org_id: orgId, question_type: 'location' })).toEqual({
      error: null,
    })

    const flow = await getQuestions(orgId)
    const restored = flow.find((q) => q.id === archivedLocationQuestion)
    expect(restored?.order_rank).toBe(Math.max(...flow.filter((q) => q.id !== archivedLocationQuestion).map((q) => q.order_rank)) + 1)
    expect(flow.find((q) => q.id === first)).toBeDefined()
  })
})
