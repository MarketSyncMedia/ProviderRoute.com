/**
 * PostgREST caps how many rows a single response may return — 1000 on Supabase
 * by default. On the public widget a truncated read does not fail, it just
 * quietly shows patients fewer providers and offerings than the org configured,
 * so every whole-org read here pages through the table.
 *
 * Mirrors src/lib/api/paginate.ts. Edge Functions are bundled from
 * supabase/functions only, so they cannot import the app's copy.
 */
export const PAGE_SIZE = 1000

/**
 * Keeps `.in()` filters well under URL length limits: 100 UUIDs is roughly
 * 3.7 KB of query string.
 */
export const IN_CHUNK_SIZE = 100

/**
 * Runs `buildPage` over successive ranges until a short page proves the end was
 * reached, returning every row. `buildPage` must apply a total ordering (end
 * with a unique column such as `id`), or rows can repeat or go missing between
 * pages. Throws on any page error rather than returning a partial list.
 */
export async function selectAllRows<Row>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const all: Row[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data) throw new Error('Paged read returned no data')
    all.push(...data)
    if (data.length < PAGE_SIZE) return all
  }
}

/** Splits `items` into consecutive chunks of at most `size`. */
export function chunk<T>(items: T[], size: number = IN_CHUNK_SIZE): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}
