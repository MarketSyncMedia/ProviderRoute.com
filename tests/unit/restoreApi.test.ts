import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The restore and archive functions for providers, constraints, locations and
 * questions, against a recorded fake of the Supabase query builder. Each
 * `from()` call takes the next queued result and records what was applied.
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
      for (const op of ['select', 'eq', 'order', 'limit', 'update', 'delete', 'in', 'contains']) {
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

import { getArchivedConstraints, restoreConstraint } from '../../src/lib/api/constraints'
import { archiveLocation, getArchivedLocations, restoreLocation } from '../../src/lib/api/locations'
import { getArchivedProviders, restoreProvider } from '../../src/lib/api/providers'
import { getArchivedQuestions, restoreQuestion } from '../../src/lib/api/questions'

const updateOf = (call: Call) => call.ops.find(([op]) => op === 'update')?.[1]

beforeEach(() => {
  fake.queue = []
  fake.calls = []
})

describe.each([
  ['providers', getArchivedProviders, restoreProvider],
  ['constraints', getArchivedConstraints, restoreConstraint],
  ['locations', getArchivedLocations, restoreLocation],
] as const)('archived %s', (table, getArchived, restore) => {
  it('lists the org’s archived rows, by name', async () => {
    fake.queue.push({ data: [{ id: 'x1', name: 'A' }], error: null })

    expect(await getArchived('org1')).toEqual([{ id: 'x1', name: 'A' }])
    expect(fake.calls[0].table).toBe(table)
    expect(fake.calls[0].ops).toContainEqual(['eq', 'org_id', 'org1'])
    expect(fake.calls[0].ops).toContainEqual(['eq', 'is_archived', true])
  })

  it('lists nothing when the read fails', async () => {
    fake.queue.push({ data: null, error: { message: 'boom' } })

    expect(await getArchived('org1')).toEqual([])
  })

  it('restores by clearing the archived flag and nothing else', async () => {
    expect(await restore('x1')).toEqual({ error: null })
    expect(updateOf(fake.calls[0])).toEqual({ is_archived: false })
    expect(fake.calls[0].ops).toContainEqual(['eq', 'id', 'x1'])
  })

  it('reports a failed restore', async () => {
    fake.queue.push({ data: null, error: { message: 'permission denied' } })

    expect(await restore('x1')).toEqual({ error: 'permission denied' })
  })
})

describe('archiveLocation', () => {
  it('only flags the location, leaving offerings and booking details as they were', async () => {
    expect(await archiveLocation('l1')).toEqual({ error: null })

    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].table).toBe('locations')
    expect(updateOf(fake.calls[0])).toEqual({ is_archived: true })
  })

  it('reports a failure', async () => {
    fake.queue.push({ data: null, error: { message: 'boom' } })

    expect(await archiveLocation('l1')).toEqual({ error: 'boom' })
  })
})

describe('restoreQuestion', () => {
  it('brings a question back at the end of the flow', async () => {
    fake.queue.push(
      { data: { order_rank: 6 }, error: null }, // current last rank
      { data: null, error: null }, // the update
    )

    const result = await restoreQuestion({ id: 'q9', org_id: 'org1', question_type: 'clinical' })

    expect(result).toEqual({ error: null })
    expect(updateOf(fake.calls[1])).toEqual({ is_archived: false, order_rank: 7 })
    expect(fake.calls[1].ops).toContainEqual(['eq', 'id', 'q9'])
  })

  it('refuses a second location or provider question, since the widget asks each once', async () => {
    for (const [type, name] of [['location', 'Location'], ['provider', 'Provider']] as const) {
      fake.calls = []
      fake.queue = [{ data: [{ id: 'live' }], error: null }]

      const result = await restoreQuestion({ id: 'q9', org_id: 'org1', question_type: type })

      expect(result.error).toBe(`The flow already has a ${name} question. The widget asks it only once.`)
      expect(fake.calls).toHaveLength(1)
      expect(fake.calls[0].ops).toContainEqual(['eq', 'question_type', type])
      expect(fake.calls[0].ops).toContainEqual(['eq', 'is_archived', false])
    }
  })

  it('restores a system question the flow no longer has', async () => {
    fake.queue.push(
      { data: [], error: null }, // none live
      { data: null, error: null }, // no live questions, so the first rank
      { data: null, error: null }, // the update
    )

    const result = await restoreQuestion({ id: 'q9', org_id: 'org1', question_type: 'location' })

    expect(result).toEqual({ error: null })
    expect(updateOf(fake.calls[2])).toEqual({ is_archived: false, order_rank: 1 })
  })

  it('does not restore when it cannot tell whether one is live', async () => {
    fake.queue.push({ data: null, error: { message: 'boom' } })

    expect(await restoreQuestion({ id: 'q9', org_id: 'org1', question_type: 'location' })).toEqual({ error: 'boom' })
    expect(fake.calls).toHaveLength(1)
  })
})

describe('getArchivedQuestions', () => {
  it('lists the org’s archived questions, most recently archived first', async () => {
    fake.queue.push({ data: [{ id: 'q1' }], error: null })

    expect(await getArchivedQuestions('org1')).toEqual([{ id: 'q1' }])
    expect(fake.calls[0].ops).toContainEqual(['eq', 'is_archived', true])
    expect(fake.calls[0].ops).toContainEqual(['order', 'updated_at', { ascending: false }])
  })
})
