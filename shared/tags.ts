// Lesson tags. Pure, so the authoring page can show a tag exactly as the library will store it.

export const MAX_TAGS = 8
export const MAX_TAG_LENGTH = 24

/** "Incident Response " and "incident_response" are one tag: incident-response. Letters and digits in any script stay; Latin accents fold, so "Résumé" is resume,
 * but other scripts' marks (Hindi vowel signs) are letters' parts and stay. Empty after cleaning means no tag. */
export const normalizeTag = (raw: string) =>
  [...raw.normalize('NFKD').replace(/[\u0300-\u036f]+/g, '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')]
    .slice(0, MAX_TAG_LENGTH).join('').replace(/-+$/, '')

/** Cleaned, without duplicates, in the author's order, and at most MAX_TAGS. */
export const normalizeTags = (raw: readonly string[]) => [...new Set(raw.map(normalizeTag).filter(Boolean))].slice(0, MAX_TAGS)
