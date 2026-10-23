import { describe, expect, it, vi } from 'vitest'
import { chunk, IN_CHUNK_SIZE, PAGE_SIZE, selectAllRows } from '../../supabase/functions/_shared/paginate'

/**
 * widget-data pages every whole-org read through this helper. A bug here would
 * not throw on the public widget — patients would just see fewer providers or
 * offerings than the org configured — so the boundaries are pinned down.
 */

/** Builds a fake pager over `total` synthetic rows, recording the ranges asked for. */
function fakeSource(total: number) {
  const ranges: Array<[number, number]> = []
  const buildPage = vi.fn(async (from: number, to: number) => {
    ranges.push([from, to])
    const rows = []
    for (let i = from; i <= to && i < total; i++) {
      rows.push({ i })
    }
    return { data: rows, error: null }
  })
  return { buildPage, ranges }
}

describe('edge selectAllRows', () => {
  it('returns every row from a single short page', async () => {
    const { buildPage } = fakeSource(3)
    expect(await selectAllRows(buildPage)).toHaveLength(3)
    expect(buildPage).toHaveBeenCalledTimes(1)
  })

  it('returns an empty array when there are no rows', async () => {
    const { buildPage } = fakeSource(0)
    expect(await selectAllRows(buildPage)).toEqual([])
  })

  it('requests non-overlapping, contiguous ranges', async () => {
    const { buildPage, ranges } = fakeSource(PAGE_SIZE * 2 + 5)
    await selectAllRows(buildPage)
    expect(ranges).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
      [PAGE_SIZE * 2, PAGE_SIZE * 3 - 1],
    ])
  })

  it('pages past the cap without dropping or duplicating rows', async () => {
    const total = PAGE_SIZE * 2 + 5
    const { buildPage } = fakeSource(total)
    const rows = await selectAllRows<{ i: number }>(buildPage)
    expect(rows).toHaveLength(total)
    expect(new Set(rows.map((r) => r.i)).size).toBe(total)
  })

  it('stops after one extra empty page when the total is an exact multiple', async () => {
    const { buildPage } = fakeSource(PAGE_SIZE)
    const rows = await selectAllRows<{ i: number }>(buildPage)
    expect(rows).toHaveLength(PAGE_SIZE)
    expect(buildPage).toHaveBeenCalledTimes(2)
  })

  it('throws rather than returning a truncated list when a later page errors', async () => {
    let call = 0
    const flaky = vi.fn(async (from: number, to: number) => {
      call += 1
      if (call > 1) return { data: null, error: { message: 'boom' } }
      const rows = []
      for (let i = from; i <= to; i++) rows.push({ i })
      return { data: rows, error: null }
    })
    await expect(selectAllRows(flaky)).rejects.toThrow('boom')
  })

  it('throws when a page comes back with neither data nor an error', async () => {
    const empty = vi.fn(async () => ({ data: null, error: null }))
    await expect(selectAllRows(empty)).rejects.toThrow()
  })
})

describe('edge chunk', () => {
  it('returns no chunks for an empty list', () => {
    expect(chunk([])).toEqual([])
  })

  it('keeps every item, in order, in chunks no larger than the limit', () => {
    const items = Array.from({ length: IN_CHUNK_SIZE * 2 + 1 }, (_, i) => i)
    const chunks = chunk(items)
    expect(chunks.map((c) => c.length)).toEqual([IN_CHUNK_SIZE, IN_CHUNK_SIZE, 1])
    expect(chunks.flat()).toEqual(items)
  })

  it('does not emit a trailing empty chunk on an exact multiple', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })
})
