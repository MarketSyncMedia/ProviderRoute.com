/**
 * A US phone number written the one way the admin shows it, "(410) 337-7900".
 * Numbers were entered as "4103377900", "(410) 337-7900" and everything between,
 * so the same list read three different ways.
 *
 * Ten digits, or eleven with a leading country code 1, are formatted. Anything
 * else (an extension, an international number, a partly typed one) is returned
 * as typed, trimmed, rather than guessed at.
 */
export function formatPhone(value: string | null | undefined): string {
  const text = (value ?? '').trim()
  const digits = text.replace(/\D/g, '')
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (national.length !== 10 || /[^\d\s().+-]/.test(text)) return text
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
}
