import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * restoreCaseType and getCaseTypeProviders, against a recorded fake of the
 * Supabase query builder. Each `from()` call takes the next queued result and
 * records the filters and the update applied to it.
 */

type Result = { data: unknown; error: unknown }
type Call = { table: string; ops: Array<[string, ...unknown[]]> }

const fake = vi.hoisted(() => ({ queue: [] as Result[], calls: [] as Call[] }))

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const call: Call = { table, ops: [] }
      fake.calls.push(call)
      const result = fake.queue.shift() ?? { data: null, error: null }
      const builder: Record<string, unknown> = {}
      for (const op of ['select', 'eq', 'order', 'limit', 'range', 'update', 'in', 'overrideTypes']) {
        builder[op] = (...args: unknown[]) => {
          call.ops.push([op, ...args])
          return builder
        }
      }
      builder.maybeSingle = () => Promise.resolve(result)
      builder.then = (ok?: (v: Result) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(ok, bad)
      return builder
    },
  },
}))

import { getCaseTypeProviders, restoreCaseType } from '../../src/lib/api/caseTypes'

function updateOf(call: Call) {
  return call.ops.find(([op]) => op === 'update')?.[1]
}

beforeEach(() => {
  fake.queue = []
  fake.calls = []
})

describe('restoreCaseType', () => {
  it('brings the case type back at the end of the list, keeping a free spot', async () => {
    fake.queue.push(
      { data: { sort_order: 4 }, error: null }, // max sort_order
      { data: [], error: null }, // nobody holds 'hip'
      { data: null, error: null }, // the update
    )

    const result = await restoreCaseType({ id: 'ct9', org_id: 'org1', map_tag: 'hip' })

    expect(result).toEqual({ error: null, lostSpot: false })
    expect(fake.calls[1].ops).toContainEqual(['eq', 'map_tag', 'hip'])
    expect(fake.calls[1].ops).toContainEqual(['eq', 'is_archived', false])
    expect(updateOf(fake.calls[2])).toEqual({ is_archived: false, sort_order: 5 })
    expect(fake.calls[2].ops).toContainEqual(['eq', 'id', 'ct9'])
  })

  it('drops the spot when another live case type took it meanwhile', async () => {
    fake.queue.push(
      { data: { sort_order: 1 }, error: null },
      { data: [{ id: 'ct2' }], error: null },
      { data: null, error: null },
    )

    const result = await restoreCaseType({ id: 'ct9', org_id: 'org1', map_tag: 'hip' })

    expect(result).toEqual({ error: null, lostSpot: true })
    expect(updateOf(fake.calls[2])).toEqual({ is_archived: false, sort_order: 2, map_tag: null })
  })

  it('skips the spot check for a case type that had no spot', async () => {
    fake.queue.push({ data: null, error: null }, { data: null, error: null })

    const result = await restoreCaseType({ id: 'ct9', org_id: 'org1', map_tag: null })

    expect(result).toEqual({ error: null, lostSpot: false })
    expect(fake.calls).toHaveLength(2)
    expect(updateOf(fake.calls[1])).toEqual({ is_archived: false, sort_order: 0 })
  })

  it('writes nothing if the spot check fails', async () => {
    fake.queue.push({ data: null, error: null }, { data: null, error: { message: 'timeout' } })

    const result = await restoreCaseType({ id: 'ct9', org_id: 'org1', map_tag: 'hip' })

    expect(result.error).toBe('timeout')
    expect(fake.calls).toHaveLength(2)
  })
})

describe('getCaseTypeProviders', () => {
  it('groups a provider’s offerings and sorts providers by name', async () => {
    fake.queue.push({
      data: [
        { id: 'o1', provider_id: 'p2', providers: { name: 'Dr. Baker' } },
        { id: 'o2', provider_id: 'p1', providers: { name: 'Dr. Adams' } },
        { id: 'o3', provider_id: 'p2', providers: { name: 'Dr. Baker' } },
      ],
      error: null,
    })

    expect(await getCaseTypeProviders('ct1')).toEqual([
      { providerId: 'p1', providerName: 'Dr. Adams', offeringIds: ['o2'] },
      { providerId: 'p2', providerName: 'Dr. Baker', offeringIds: ['o1', 'o3'] },
    ])
    const ops = fake.calls[0].ops
    expect(ops).toContainEqual(['eq', 'case_type_id', 'ct1'])
    expect(ops).toContainEqual(['eq', 'is_archived', false])
    expect(ops).toContainEqual(['eq', 'providers.is_archived', false])
  })

  it('throws instead of reporting no providers when the read fails', async () => {
    fake.queue.push({ data: null, error: { message: 'boom' } })

    await expect(getCaseTypeProviders('ct1')).rejects.toThrow(/could not load/i)
  })
})
