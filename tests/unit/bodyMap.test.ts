import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BODY_MAP_SPOTS, BODY_MAP_TAGS, spotsMatchingName, suggestMapTags } from '../../src/shared/bodyMap'

const ct = (id: string, name: string, map_tag: string | null = null) => ({ id, name, map_tag })

describe('body map spots', () => {
  it('match the tags the database accepts', () => {
    // The latest migration that defines case_types_map_tag_check is the one in force.
    const dir = resolve(import.meta.dirname, '../../supabase/migrations')
    const defining = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .filter((sql) => /ADD CONSTRAINT case_types_map_tag_check/.test(sql))
    expect(defining.length).toBeGreaterThan(0)

    const check = /ADD CONSTRAINT case_types_map_tag_check CHECK \(([\s\S]*?)\);/.exec(defining.at(-1)!)
    const allowed = [...check![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect([...allowed].sort()).toEqual([...BODY_MAP_TAGS].sort())
  })

  it('have unique tags and positions inside the figure', () => {
    expect(new Set(BODY_MAP_TAGS).size).toBe(BODY_MAP_TAGS.length)
    for (const spot of BODY_MAP_SPOTS) {
      expect(spot.x).toBeGreaterThanOrEqual(0)
      expect(spot.x).toBeLessThanOrEqual(100)
      expect(spot.y).toBeGreaterThanOrEqual(0)
      expect(spot.y).toBeLessThanOrEqual(100)
    }
  })
})

describe('spotsMatchingName', () => {
  it('matches whole words regardless of case and punctuation', () => {
    expect(spotsMatchingName('Knee Pain').map((s) => s.tag)).toEqual(['knee'])
    expect(spotsMatchingName('LOWER-BACK pain').map((s) => s.tag)).toEqual(['low-back'])
    expect(spotsMatchingName('Shin Splints').map((s) => s.tag)).toEqual(['shin-splints'])
  })

  it('does not match inside other words', () => {
    expect(spotsMatchingName('Hipster')).toEqual([])
    expect(spotsMatchingName('Shoulders')).toEqual([])
    expect(spotsMatchingName('Backache')).toEqual([])
  })
})

describe('suggestMapTags', () => {
  it('suggests a spot for each name that clearly names one', () => {
    expect(suggestMapTags([ct('1', 'Knee'), ct('2', 'Achilles Tendon')])).toEqual([
      { caseTypeId: '1', caseTypeName: 'Knee', tag: 'knee' },
      { caseTypeId: '2', caseTypeName: 'Achilles Tendon', tag: 'achilles' },
    ])
  })

  it('skips names that match more than one spot', () => {
    expect(suggestMapTags([ct('1', 'Foot and Ankle')])).toEqual([])
  })

  it('skips a spot two names compete for', () => {
    expect(suggestMapTags([ct('1', 'Knee Pain'), ct('2', 'Knee Replacement')])).toEqual([])
  })

  it('leaves tagged case types and taken spots alone', () => {
    expect(suggestMapTags([ct('1', 'Knee', 'hip'), ct('2', 'Hip Pain'), ct('3', 'Wrist')])).toEqual([
      { caseTypeId: '3', caseTypeName: 'Wrist', tag: 'wrist' },
    ])
  })

  it('suggests nothing for names with no body part', () => {
    expect(suggestMapTags([ct('1', 'General Orthopedics'), ct('2', 'Back Pain')])).toEqual([])
  })
})
