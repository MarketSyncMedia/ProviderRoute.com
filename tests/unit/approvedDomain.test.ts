import { describe, expect, it } from 'vitest'
import { approvedDomainListProblem, normalizeApprovedDomain } from '../../src/lib/approvedDomain'

describe('approved domains', () => {
  it('normalizes full hostnames and rejects dangerously broad entries', () => {
    expect(normalizeApprovedDomain('https://Portal.Example.com:443/path')).toBe('portal.example.com')
    expect(normalizeApprovedDomain('*.example.com')).toBeNull()
    expect(normalizeApprovedDomain('com')).toBeNull()
    expect(normalizeApprovedDomain('example.com.attacker.test')).toBe('example.com.attacker.test')
  })
})

describe('approvedDomainListProblem', () => {
  it('accepts a list of full domains, ignoring blank lines', () => {
    expect(approvedDomainListProblem('towsonortho.com\n\n  www.example.org  ')).toBeNull()
    expect(approvedDomainListProblem('')).toBeNull()
  })

  it('names every entry it rejects, so the admin knows which line to fix', () => {
    const problem = approvedDomainListProblem('toa.example.com\nlocalhost\n*.example.com')
    expect(problem).toContain('"localhost"')
    expect(problem).toContain('"*.example.com"')
    expect(problem).not.toContain('toa.example.com"')
    expect(problem).toContain('ignores them')
  })

  it('caps the list at 50 distinct domains', () => {
    const list = Array.from({ length: 51 }, (_, i) => `site${i}.example.com`).join('\n')
    expect(approvedDomainListProblem(list)).toContain('at most 50')
    // Duplicates collapse when saved, so they don't count against the cap.
    expect(approvedDomainListProblem(Array(60).fill('example.com').join('\n'))).toBeNull()
  })
})
