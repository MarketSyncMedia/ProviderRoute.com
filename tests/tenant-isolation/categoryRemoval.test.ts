import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createTestHarness, type TestHarness } from './fixtures'

/**
 * Removing and merging categories run against the real tables as a signed-in
 * admin. A category is an id inside each provider's category_ids array rather
 * than a foreign key, so deleting the row alone would leave dangling ids on
 * every provider: the API has to rewrite those first.
 */

const db = vi.hoisted(() => ({ client: null as SupabaseClient | null }))

vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.client
  },
}))

import { getCategoryProviders, removeCategory } from '../../src/lib/api/categories'

let harness: TestHarness
const ids = {} as Record<'good' | 'bad' | 'other' | 'p1' | 'p2' | 'p3', string>

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.client!.from(table).insert(row).select('id').single()
  if (error || !data) throw new Error(`Failed to seed ${table}: ${error?.message}`)
  return data.id as string
}

async function categoriesOf(providerId: string): Promise<string[]> {
  const { data, error } = await db.client!.from('providers').select('category_ids').eq('id', providerId).single()
  expect(error).toBeNull()
  return [...((data?.category_ids as string[]) ?? [])].sort()
}

async function categoryExists(id: string): Promise<boolean> {
  const { data, error } = await db.client!.from('categories').select('id').eq('id', id)
  expect(error).toBeNull()
  return (data ?? []).length > 0
}

beforeAll(async () => {
  harness = await createTestHarness()
  const { client, orgId } = harness.tenantA
  db.client = client

  ids.good = await insert('categories', { org_id: orgId, name: 'Removal Test Sports Medicine' })
  ids.bad = await insert('categories', { org_id: orgId, name: 'Removal Test Sports Medincine' })
  ids.other = await insert('categories', { org_id: orgId, name: 'Removal Test Other' })

  const provider = (name: string, categoryIds: string[]) =>
    insert('providers', {
      org_id: orgId,
      name,
      normalized_name: name.toLowerCase(),
      category_ids: categoryIds,
    })
  ids.p1 = await provider('Removal Test Provider 1', [ids.bad, ids.other])
  ids.p2 = await provider('Removal Test Provider 2', [ids.bad, ids.good])
  ids.p3 = await provider('Removal Test Provider 3', [ids.other])
}, 120_000)

afterAll(async () => {
  db.client = null
  if (harness) {
    await harness.cleanup()
  }
}, 120_000)

describe('removing and merging categories', () => {
  it('lists the providers that carry a category', async () => {
    const providers = await getCategoryProviders(ids.bad)

    expect(providers.map((p) => p.id).sort()).toEqual([ids.p1, ids.p2].sort())
  })

  it('merges a misspelled category into the right one, once per provider', async () => {
    const result = await removeCategory(ids.bad, ids.good)

    expect(result).toEqual({ error: null, providersUpdated: 2 })
    // p1 gains the right one; p2 already had it and must not get it twice.
    expect(await categoriesOf(ids.p1)).toEqual([ids.good, ids.other].sort())
    expect(await categoriesOf(ids.p2)).toEqual([ids.good])
    expect(await categoriesOf(ids.p3)).toEqual([ids.other])
    expect(await categoryExists(ids.bad)).toBe(false)
  })

  it('removes a category from every provider without leaving a dangling id', async () => {
    const result = await removeCategory(ids.other, null)

    expect(result).toEqual({ error: null, providersUpdated: 2 })
    expect(await categoriesOf(ids.p1)).toEqual([ids.good])
    expect(await categoriesOf(ids.p3)).toEqual([])
    expect(await categoryExists(ids.other)).toBe(false)
    expect(await categoryExists(ids.good)).toBe(true)
  })

  it('can remove a category no provider has', async () => {
    const orphan = await insert('categories', { org_id: harness.tenantA.orgId, name: 'Removal Test Unused' })

    expect(await removeCategory(orphan, null)).toEqual({ error: null, providersUpdated: 0 })
    expect(await categoryExists(orphan)).toBe(false)
  })
})
