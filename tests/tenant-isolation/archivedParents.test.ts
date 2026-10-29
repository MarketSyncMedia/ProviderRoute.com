import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createTestHarness, type TestHarness } from './fixtures'

/**
 * Archiving a case type or a provider keeps its offerings as they are, so a
 * restore brings them back. Every offering read has to hide them meanwhile,
 * or the data table and provider pages list them with "Unknown" for a name.
 *
 * The hiding is done by PostgREST inner joins, which a mocked query builder
 * cannot prove, so these run the app's own API functions against the database
 * as a signed-in admin.
 */

const db = vi.hoisted(() => ({ client: null as SupabaseClient | null }))

vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.client
  },
}))

import { archiveCaseType, getCaseTypeOfferingCounts, restoreCaseType } from '../../src/lib/api/caseTypes'
import { getCategoryOfferingCounts } from '../../src/lib/api/categories'
import { getArchivedDataTableOfferings, getDataTableOfferings } from '../../src/lib/api/dataTable'
import { getLocationOfferingCounts } from '../../src/lib/api/locations'
import { getArchivedOfferingsByProvider, getOfferingsByProvider } from '../../src/lib/api/offerings'
import { archiveProvider } from '../../src/lib/api/providers'

let harness: TestHarness
const ids = {} as Record<
  'kept' | 'archived' | 'otherProvider' | 'keptCaseType' | 'archivedCaseType' | 'category' | 'location',
  string
> & { offerings: Record<string, string> }

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.client!.from(table).insert(row).select('id').single()
  if (error || !data) throw new Error(`Failed to seed ${table}: ${error?.message}`)
  return data.id as string
}

beforeAll(async () => {
  harness = await createTestHarness()
  const { client, orgId, records } = harness.tenantA
  db.client = client

  ids.location = records.location
  ids.category = await insert('categories', { org_id: orgId, name: 'Archive Test Category' })
  ids.kept = records.provider
  const { error } = await client.from('providers').update({ category_ids: [ids.category] }).eq('id', ids.kept)
  if (error) throw new Error(error.message)
  ids.otherProvider = await insert('providers', {
    org_id: orgId,
    name: 'Archive Test Provider 2',
    normalized_name: 'archive test provider 2',
    category_ids: [ids.category],
  })
  ids.keptCaseType = await insert('case_types', { org_id: orgId, name: 'Archive Test Knee' })
  ids.archivedCaseType = await insert('case_types', { org_id: orgId, name: 'Archive Test Hip' })

  const offering = (providerId: string, caseTypeId: string, isArchived: boolean) =>
    insert('offerings', {
      org_id: orgId,
      provider_id: providerId,
      case_type_id: caseTypeId,
      location_ids: [ids.location],
      constraints: {},
      is_archived: isArchived,
    })
  ids.offerings = {
    live: await offering(ids.kept, ids.keptCaseType, false),
    liveArchivedCaseType: await offering(ids.kept, ids.archivedCaseType, false),
    removed: await offering(ids.kept, ids.keptCaseType, true),
    removedArchivedCaseType: await offering(ids.kept, ids.archivedCaseType, true),
    otherProviderLive: await offering(ids.otherProvider, ids.keptCaseType, false),
    otherProviderRemoved: await offering(ids.otherProvider, ids.keptCaseType, true),
  }

  expect((await archiveCaseType(ids.archivedCaseType)).error).toBeNull()
  expect((await archiveProvider(ids.otherProvider)).error).toBeNull()
}, 120_000)

afterAll(async () => {
  db.client = null
  if (harness) {
    await harness.cleanup()
  }
}, 120_000)

const idsOf = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort()

describe('offerings of an archived case type or provider', () => {
  it('drop out of the data table', async () => {
    const rows = await getDataTableOfferings(harness.tenantA.orgId)

    expect(idsOf(rows)).toEqual([ids.offerings.live])
    expect(rows[0].providers?.name).toBeTruthy()
  })

  it("drop out of the data table's Archived view, where restoring them would not bring them back", async () => {
    expect(idsOf(await getArchivedDataTableOfferings(harness.tenantA.orgId))).toEqual([ids.offerings.removed])
  })

  it("drop out of the provider's offerings and archived offerings", async () => {
    expect(idsOf(await getOfferingsByProvider(ids.kept))).toEqual([ids.offerings.live])
    expect(idsOf(await getArchivedOfferingsByProvider(ids.kept))).toEqual([ids.offerings.removed])
  })

  it('are not counted on the case type, location or category lists', async () => {
    expect(await getCaseTypeOfferingCounts([ids.keptCaseType])).toEqual({ [ids.keptCaseType]: 1 })
    expect(await getLocationOfferingCounts([ids.location])).toEqual({ [ids.location]: 1 })
    expect(await getCategoryOfferingCounts([ids.category])).toEqual({ [ids.category]: 1 })
  })

  it('come back as they were when the case type is restored', async () => {
    const restored = await restoreCaseType({ id: ids.archivedCaseType, org_id: harness.tenantA.orgId, map_tag: null })
    expect(restored.error).toBeNull()

    expect(idsOf(await getOfferingsByProvider(ids.kept))).toEqual(
      [ids.offerings.live, ids.offerings.liveArchivedCaseType].sort(),
    )
    expect(idsOf(await getArchivedOfferingsByProvider(ids.kept))).toEqual(
      [ids.offerings.removed, ids.offerings.removedArchivedCaseType].sort(),
    )
  })
})
