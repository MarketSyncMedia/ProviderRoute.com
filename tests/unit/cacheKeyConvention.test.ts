import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the cache-key convention, because this bug shipped four separate times.
 *
 * Four list pages decorate their entities with a usage count and cache
 * `{entity, count}` rows. Other pages read the plain `Entity[]` for the same
 * table. React Query caches by key, so when both shapes shared one key,
 * whichever mounted first served its shape to the other and the receiving page
 * rendered `undefined` for every name.
 *
 * The convention that fixes it:
 *   1. an augmented list caches under `<entity>-with-counts`, never `<entity>`
 *   2. it still invalidates the plain `<entity>` key, or the pages reading that
 *      key silently stop refreshing after an add/edit/archive
 *
 * Both halves matter, and (2) is the easy one to drop while "cleaning up" — so
 * both are asserted here at the source level, where a regression is obvious.
 *
 * The `ownKeyPattern`s deliberately require the key to be followed by
 * `queryFn`: the bare string also appears in the invalidate calls, so matching
 * it alone would let a reverted query declaration slip through.
 */

const AUGMENTED_LISTS = [
  {
    label: 'CategoriesPage',
    file: 'src/pages/categories/CategoriesPage.tsx',
    plainKey: 'categories',
    // Uses the shared component, so it declares its keys as props.
    ownKeyPattern: /queryKey="categories-with-counts"/,
    invalidatesPattern: /alsoInvalidate=\{\['categories'\]\}/,
  },
  {
    label: 'CaseTypesPage',
    file: 'src/pages/case-types/CaseTypesPage.tsx',
    plainKey: 'case-types',
    ownKeyPattern: /queryKey="case-types-with-counts"/,
    invalidatesPattern: /alsoInvalidate=\{\['case-types'\]\}/,
  },
  {
    label: 'LocationsPage',
    file: 'src/pages/locations/LocationsPage.tsx',
    plainKey: 'locations',
    ownKeyPattern: /queryKey: \['locations-with-counts', orgId\],\s*\n\s*queryFn/,
    invalidatesPattern: /invalidateQueries\(\{ queryKey: \['locations', orgId\] \}\)/,
  },
  {
    label: 'ConstraintsPage',
    file: 'src/pages/constraints/ConstraintsPage.tsx',
    plainKey: 'constraints',
    ownKeyPattern: /queryKey: \['constraints-with-counts', orgId\],\s*\n\s*queryFn/,
    invalidatesPattern: /invalidateQueries\(\{ queryKey: \['constraints', orgId\] \}\)/,
  },
] as const

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8')
}

/** The loader every reader of a shared plain list key must use. */
const SHARED_LISTS = [
  ['case-types', 'getCaseTypes'],
  ['categories', 'getCategories'],
  ['locations', 'getLocations'],
  ['constraints', 'getConstraints'],
] as const

describe('shared list loaders', () => {
  const sources = readdirSync(resolve(process.cwd(), 'src'), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => ({ file, src: read(`src/${file}`) }))

  // Pages sharing a key used to load it their own way, some sorted and some
  // not. Whichever opened first set the order everywhere: a case type dropdown
  // could ignore the drag order the admin chose on the Case Types page.
  it.each(SHARED_LISTS)('every ["%s", orgId] query loads with %s', (key, loader) => {
    const declaration = new RegExp(`queryKey: \\['${key}', orgId\\],\\s*queryFn: (.*)`, 'g')
    const loaders = sources.flatMap(({ src }) => [...src.matchAll(declaration)].map((match) => match[1].trim()))

    expect(loaders.length).toBeGreaterThan(0)
    expect(new Set(loaders)).toEqual(new Set([`() => ${loader}(orgId),`]))
  })
})

describe('augmented list cache keys', () => {
  it.each(AUGMENTED_LISTS)(
    '$label caches its counts-augmented rows under a dedicated key',
    ({ file, ownKeyPattern }) => {
      expect(read(file)).toMatch(ownKeyPattern)
    },
  )

  it.each(AUGMENTED_LISTS)(
    '$label does not run its own query on the shared plain key',
    ({ file, plainKey }) => {
      const src = read(file)
      // A `useQuery` on the bare key is the regression: it puts augmented rows
      // back into the cache slot the plain-shape readers use.
      const declaresOwnQueryOnPlainKey =
        new RegExp(`queryKey: \\['${plainKey}', orgId\\],\\s*\\n\\s*queryFn`).test(src) ||
        new RegExp(`queryKey="${plainKey}"`).test(src)
      expect(declaresOwnQueryOnPlainKey).toBe(false)
    },
  )

  it.each(AUGMENTED_LISTS)(
    '$label still invalidates the plain key so other pages refresh',
    ({ file, invalidatesPattern }) => {
      expect(read(file)).toMatch(invalidatesPattern)
    },
  )
})
