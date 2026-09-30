import { describe, it, expect } from 'vitest'
import { advance } from './Suggest.tsx'

describe('advance', () => {
  it('keeps the rest of the suggestion while they type what it says', () => {
    expect(advance(' at a startup', 'A shift', 'A shift at')).toBe(' a startup')
    expect(advance(' at a startup', 'A shift', 'A shift at a startup')).toBe('')
  })
  it('drops it when they type something else, delete, or edit earlier text', () => {
    expect(advance(' at a startup', 'A shift', 'A shift in')).toBe('')
    expect(advance(' at a startup', 'A shift', 'A shif')).toBe('')
    expect(advance(' at a startup', 'A shift', 'The shift')).toBe('')
  })
  it('has nothing to keep without a suggestion', () => {
    expect(advance('', 'A shift', 'A shift ')).toBe('')
  })
})
