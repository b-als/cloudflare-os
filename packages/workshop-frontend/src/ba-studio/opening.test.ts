// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  forgetOpening, MAX_DERIVED_NAME_LENGTH, openingMessage, processNameFrom, readOpening, rememberOpening,
} from './opening'

describe('processNameFrom', () => {
  it('uses the first sentence, capitalised, without trailing punctuation', () => {
    expect(processNameFrom('how we approve vendor invoices. It takes forever.')).toBe('How we approve vendor invoices')
    expect(processNameFrom('  New hire laptops!\nIT always forgets the monitor')).toBe('New hire laptops')
  })

  it('names a run-on description after its first clause', () => {
    expect(processNameFrom(
      'When a customer asks for a refund, support checks the order in Shopify, and finance pays it.',
    )).toBe('When a customer asks for a refund')
    expect(processNameFrom('So, every month end we reconcile the bank feeds')).toBe(
      'So, every month end we reconcile the bank feeds',
    )
  })

  it('cuts a long sentence at a word boundary', () => {
    const name = processNameFrom(
      'when a customer terminates their contract we have to extract all of their data and then delete it everywhere',
    )
    expect(name.length).toBeLessThanOrEqual(MAX_DERIVED_NAME_LENGTH)
    expect(name.endsWith('…')).toBe(true)
    expect(name).not.toMatch(/\s…$/)
    expect(name.startsWith('When a customer terminates')).toBe(true)
  })

  it('falls back when there is nothing to name it by', () => {
    expect(processNameFrom('   ')).toBe('Untitled process')
    expect(processNameFrom('...')).toBe('Untitled process')
  })
})

describe('openingMessage', () => {
  it("keeps the person's words, framed as mapping", () => {
    expect(openingMessage('  supplier offboarding  ')).toBe('Help me map this process: supplier offboarding')
  })
})

describe('opening hand-off', () => {
  afterEach(() => sessionStorage.clear())

  it('survives repeated reads until the session forgets it', () => {
    rememberOpening('ws-1', 'refund approvals')
    expect(readOpening('ws-1')).toBe('refund approvals')
    expect(readOpening('ws-1')).toBe('refund approvals')
    forgetOpening('ws-1')
    expect(readOpening('ws-1')).toBeNull()
  })

  it('belongs to one workspace', () => {
    rememberOpening('ws-1', 'refund approvals')
    expect(readOpening('ws-2')).toBeNull()
    expect(readOpening('ws-1')).toBe('refund approvals')
  })
})
