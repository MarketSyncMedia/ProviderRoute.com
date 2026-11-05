import { describe, expect, it } from 'vitest'
import { applyNameFixes, findSimilarName, nameFixKey, suggestNameFixes } from '../../src/lib/similarNames'

describe('findSimilarName', () => {
  const existing = ['Sports Medicine', 'Joint Replacement', 'Hand & Upper Extremity Specialist']

  it('recognises a misspelling of an existing name', () => {
    expect(findSimilarName('Sports Medincine', existing)?.name).toBe('Sports Medicine')
    expect(findSimilarName('Joint Replacment', existing)?.name).toBe('Joint Replacement')
    expect(findSimilarName('sports medecine', existing)?.name).toBe('Sports Medicine')
  })

  it('picks the closest of several', () => {
    expect(findSimilarName('Sports Medicin', ['Sports Medicine', 'Sports Medication'])?.name).toBe('Sports Medicine')
  })

  it('does not flag names that are only different words', () => {
    expect(findSimilarName('Hip', ['Knee', 'Hop', 'Elbow'])).toBeNull()
    expect(findSimilarName('Foot', ['Food', 'Ankle'])).toBeNull()
    expect(findSimilarName('Non-operative', existing)).toBeNull()
  })

  it('leaves exact matches to the duplicate check, ignoring case', () => {
    expect(findSimilarName('sports medicine', existing)).toBeNull()
    expect(findSimilarName('SPORTS MEDICINE', existing)).toBeNull()
  })

  it('treats different spacing or punctuation as a likely typo', () => {
    expect(findSimilarName('Sports-Medicine', existing)?.name).toBe('Sports Medicine')
    expect(findSimilarName('SportsMedicine', existing)?.name).toBe('Sports Medicine')
  })

  it('copes with nothing to compare', () => {
    expect(findSimilarName('', existing)).toBeNull()
    expect(findSimilarName('Sports Medincine', [])).toBeNull()
  })
})

describe('suggestNameFixes', () => {
  const base = {
    caseTypeHeader: 'Case Type',
    categoryHeader: 'Category',
    existingCaseTypes: ['Knee', 'Shoulder'],
    existingCategories: ['Sports Medicine', 'Joint Replacement'],
  }

  it('finds near-misses among case types and the categories in a list', () => {
    const rows = [
      { 'Case Type': 'Shoulders', Category: 'Sports Medincine, Joint Replacement' },
      { 'Case Type': 'Knee', Category: 'Sports Medicine' },
    ]
    expect(suggestNameFixes({ ...base, rows })).toEqual([
      expect.objectContaining({ kind: 'caseType', incoming: 'Shoulders', suggested: 'Shoulder' }),
      expect.objectContaining({ kind: 'category', incoming: 'Sports Medincine', suggested: 'Sports Medicine' }),
    ])
  })

  it('reports each misspelling once however many rows repeat it', () => {
    const rows = [
      { 'Case Type': 'Knee', Category: 'Sports Medincine' },
      { 'Case Type': 'Knee', Category: 'sports medincine' },
      { 'Case Type': 'Knee', Category: 'Sports Medincine' },
    ]
    expect(suggestNameFixes({ ...base, rows })).toHaveLength(1)
  })

  it('suggests nothing for exact matches or names that are simply new', () => {
    const rows = [{ 'Case Type': 'knee', Category: 'Sports Medicine, Podiatry' }]
    expect(suggestNameFixes({ ...base, rows })).toEqual([])
  })
})

describe('applyNameFixes', () => {
  const fixes = [
    { kind: 'caseType' as const, incoming: 'Shoulders', suggested: 'Shoulder', score: 0.9 },
    { kind: 'category' as const, incoming: 'Sports Medincine', suggested: 'Sports Medicine', score: 0.94 },
  ]

  it('swaps the matched name into case type cells and into each matching category', () => {
    const rows = [{ Provider: 'Dr. A', 'Case Type': ' shoulders ', Category: 'Sports Medincine, Joint Replacement' }]
    expect(applyNameFixes(rows, 'Case Type', 'Category', fixes)).toEqual([
      { Provider: 'Dr. A', 'Case Type': 'Shoulder', Category: 'Sports Medicine, Joint Replacement' },
    ])
  })

  it('leaves other rows and the originals untouched', () => {
    const rows = [{ Provider: 'Dr. B', 'Case Type': 'Knee', Category: 'Joint Replacement' }]
    const result = applyNameFixes(rows, 'Case Type', 'Category', fixes)
    expect(result).toEqual(rows)
    expect(result[0]).toBe(rows[0])
  })

  it('hands back the same rows when there is nothing to apply', () => {
    const rows = [{ 'Case Type': 'Shoulders' }]
    expect(applyNameFixes(rows, 'Case Type', undefined, [])).toBe(rows)
  })

  it('keys a fix by kind and trimmed, lower-cased name', () => {
    expect(nameFixKey({ kind: 'category', incoming: ' Sports Medincine ' })).toBe('category:sports medincine')
  })
})
