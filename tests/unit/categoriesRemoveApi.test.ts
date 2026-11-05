import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * removeCategory and getCategoryProviders, against a recorded fake of the
 * Supabase query builder. Each `from()` call takes the next queued result and
 * records the filters, update and delete applied to it.
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
      for (const op of ['select', 'eq', 'order', 'range', 'update', 'delete', 'contains']) {
        builder[op] = (...args: unknown[]) => {
          call.ops.push([op, ...args])
          return builder
        }
      }
      builder.then = (ok?: (v: Result) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(ok, bad)
      return builder
    },
  },
}))

import { getCategoryProviders, removeCategory } from '../../src/lib/api/categories'

const updateOf = (call: Call) => call.ops.find(([op]) => op === 'update')?.[1]
const has = (call: Call, op: string) => call.ops.some(([name]) => name === op)

beforeEach(() => {
  fake.queue = []
  fake.calls = []
})

describe('removeCategory', () => {
  it('takes the category off each provider that has it, then deletes it', async () => {
    fake.queue.push(
      {
        data: [
          { id: 'p1', category_ids: ['bad', 'keep'] },
          { id: 'p2', category_ids: ['bad'] },
        ],
        error: null,
      },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
    )

    const result = await removeCategory('bad', null)

    expect(result).toEqual({ error: null, providersUpdated: 2 })
    expect(fake.calls[0].ops).toContainEqual(['contains', 'category_ids', ['bad']])
    expect(updateOf(fake.calls[1])).toEqual({ category_ids: ['keep'] })
    expect(updateOf(fake.calls[2])).toEqual({ category_ids: [] })
    expect(fake.calls[3].table).toBe('categories')
    expect(has(fake.calls[3], 'delete')).toBe(true)
    expect(fake.calls[3].ops).toContainEqual(['eq', 'id', 'bad'])
  })

  it('swaps in the category it is merged into, without duplicating one the provider has', async () => {
    fake.queue.push(
      {
        data: [
          { id: 'p1', category_ids: ['bad'] },
          { id: 'p2', category_ids: ['bad', 'good'] },
        ],
        error: null,
      },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
    )

    await removeCategory('bad', 'good')

    expect(updateOf(fake.calls[1])).toEqual({ category_ids: ['good'] })
    expect(updateOf(fake.calls[2])).toEqual({ category_ids: ['good'] })
  })

  it('deletes a category no provider has', async () => {
    fake.queue.push({ data: [], error: null }, { data: null, error: null })

    expect(await removeCategory('bad', null)).toEqual({ error: null, providersUpdated: 0 })
    expect(fake.calls).toHaveLength(2)
    expect(has(fake.calls[1], 'delete')).toBe(true)
  })

  it('leaves the category in place when a provider cannot be updated, so it can be retried', async () => {
    fake.queue.push(
      {
        data: [
          { id: 'p1', category_ids: ['bad'] },
          { id: 'p2', category_ids: ['bad'] },
        ],
        error: null,
      },
      { data: null, error: null },
      { data: null, error: { message: 'permission denied' } },
    )

    const result = await removeCategory('bad', null)

    expect(result).toEqual({ error: 'permission denied', providersUpdated: 1 })
    expect(fake.calls.every((call) => !has(call, 'delete'))).toBe(true)
  })

  it('does not delete when the providers could not be read', async () => {
    fake.queue.push({ data: null, error: { message: 'boom' } })

    const result = await removeCategory('bad', null)

    expect(result.error).toMatch(/could not load/i)
    expect(fake.calls).toHaveLength(1)
  })
})

describe('getCategoryProviders', () => {
  it('lists the providers carrying the category, archived ones included', async () => {
    fake.queue.push({ data: [{ id: 'p1', name: 'Dr. Adams' }], error: null })

    expect(await getCategoryProviders('cat1')).toEqual([{ id: 'p1', name: 'Dr. Adams' }])
    expect(fake.calls[0].ops).toContainEqual(['contains', 'category_ids', ['cat1']])
    expect(fake.calls[0].ops.some(([op, column]) => op === 'eq' && column === 'is_archived')).toBe(false)
  })

  it('throws rather than reporting none when it cannot read them', async () => {
    fake.queue.push({ data: null, error: { message: 'boom' } })

    await expect(getCategoryProviders('cat1')).rejects.toThrow(/could not load/i)
  })
})
