// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TooltipProvider } from '@cloudflare/kumo'
import { LANE_HEIGHT } from '@gadgets/gatekeeper-process/graph-ops'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesignReview } from './DesignReview'
import { SAMPLE_ENTRIES, inStepScope } from './sampleData'
import type { ProcessMapProps } from '../ProcessMap'
import { saveTextToFile } from '../../fileTransfers'

vi.mock('../ProcessMap', () => ({
  default: ({ graph, onPickStep, preview, onOpenStepProperties, focusStepId, openItemCounts, onClearStep }: ProcessMapProps) => (
    <div>
      {graph.nodes.map((step) => (
        <button key={step.id} data-step-id={step.id} data-team={step.laneId} data-y={step.y}
          data-selected={String(focusStepId === step.id)} data-open={String(openItemCounts?.[step.id] ?? 0)}
          onClick={() => onPickStep(step)} onDoubleClick={() => onOpenStepProperties?.(step)}>
          Pick {step.label}<span data-assignee={step.id}>{step.owner}</span>
        </button>
      ))}
      <button onClick={() => onClearStep?.()}>Clear map selection</button>
      {preview && <span>Sample map proposal</span>}
    </div>
  ),
}))
vi.mock('../PhaseIndicator', () => ({ PhaseIndicator: () => <p>Understand / Map / Improve / Ship</p> }))
vi.mock('../../fileTransfers', () => ({ saveTextToFile: vi.fn<typeof saveTextToFile>() }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mediaQuery = (media: string, matches: boolean): MediaQueryList => ({
  media, matches, onchange: null,
  addEventListener: vi.fn<MediaQueryList['addEventListener']>(),
  removeEventListener: vi.fn<MediaQueryList['removeEventListener']>(),
  addListener: vi.fn<MediaQueryList['addListener']>(),
  removeListener: vi.fn<MediaQueryList['removeListener']>(),
  dispatchEvent: vi.fn<MediaQueryList['dispatchEvent']>(() => true),
})

const stepName = () => {
  const input = [...document.querySelectorAll('label')].find((item) => item.textContent === 'Step name')?.control
  return input instanceof HTMLInputElement ? input : undefined
}

const select = async (label: string, option: string) => {
  const trigger = document.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${label}"]`)!
  await act(async () => trigger.click())
  const target = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === option)!
  expect(target).toBeTruthy()
  expect(target.closest('[aria-hidden="true"]')).toBeNull()
  await act(async () => {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    target.click()
  })
  expect(trigger.textContent).toContain(option)
}

describe('isolated BA design review', () => {
  let root: Root
  let container: HTMLDivElement
  const previousScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Design review must not fetch project data.') }))
    vi.stubGlobal('WebSocket', vi.fn(() => { throw new Error('Design review must not connect to project RPC.') }))
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    vi.stubGlobal('matchMedia', vi.fn<typeof window.matchMedia>((media) => mediaQuery(media, false)))
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn<Element['scrollIntoView']>() })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(<TooltipProvider><DesignReview /></TooltipProvider>))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    if (previousScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', previousScrollIntoView)
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  })

  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find((item) =>
      item.getAttribute('aria-label') === label || item.textContent?.trim() === label ||
      (label.startsWith('Pick ') && item.textContent?.startsWith(label)))
    expect(button).toBeDefined()
    await act(async () => button!.click())
  }

  const enter = async (label: string, value: string) => {
    const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`) ??
      [...container.querySelectorAll('label')].find((item) => item.textContent === label)?.control
    expect(input).toBeTruthy()
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
      input!.dispatchEvent(new Event('input', { bubbles: true }))
      input!.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  const doubleClickStep = async (id: string) => {
    const button = container.querySelector(`[data-step-id="${id}"]`)!
    await act(async () => button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  }

  const clickRecord = async (id: string) => {
    const button = container.querySelector<HTMLButtonElement>(`[data-record-id="${id}"] button`)
    expect(button).not.toBeNull()
    await act(async () => button!.click())
  }

  const context = () => container.querySelector('[aria-label="Process context"]')
  const mapStep = (id: string) => container.querySelector(`[data-step-id="${id}"]`)!

  it('starts with labelled sample knowledge and does not make network calls', () => {
    expect(container.textContent).toContain('Fictional data')
    expect(context()?.textContent).toContain('Maya Patel')
    expect(context()?.textContent).toContain('Current baseline: not established')
    expect(fetch).not.toHaveBeenCalled()
    expect(WebSocket).not.toHaveBeenCalled()
  })

  it('has no separate brief, tabs or search competing with the map', () => {
    expect(container.querySelector('[aria-label="Process brief"]')).toBeNull()
    expect(container.querySelector('[role="tab"]')).toBeNull()
    expect(container.querySelector('input[type="search"], [aria-label="Search process brief"]')).toBeNull()
  })

  it('shows unresolved work on the map steps it concerns', async () => {
    expect(mapStep('approve').getAttribute('data-open')).toBe('4')
    expect(mapStep('match').getAttribute('data-open')).toBe('2')
    expect(mapStep('receive').getAttribute('data-open')).toBe('0')
    await click('Accept sample')
    expect(mapStep('approve').getAttribute('data-open')).toBe('3')
  })

  it('focuses context on a picked step and returns to the whole process', async () => {
    await click('Pick Approve invoice')
    expect(context()?.querySelector('h2')?.textContent).toBe('Approve invoice')
    expect(context()?.textContent).toContain('Alex Chen')
    expect(context()?.textContent).not.toContain('Jo Morgan')
    await click('Whole process')
    expect(context()?.textContent).toContain('Jo Morgan')
    expect(mapStep('approve').getAttribute('data-selected')).toBe('false')
  })

  it('returns to the whole process when the step is deselected on the canvas', async () => {
    await click('Pick Approve invoice')
    await click('Clear map selection')
    expect(context()?.textContent).toContain('Whole process · goal')
  })

  it('links the conversation to the map and highlights cards about the focused step', async () => {
    expect(container.textContent).not.toContain('About the focused step')
    await click('Show Approve invoice on map')
    expect(mapStep('approve').getAttribute('data-selected')).toBe('true')
    expect(context()?.querySelector('h2')?.textContent).toBe('Approve invoice')
    expect(container.querySelectorAll('[aria-label="Sample conversation"] [data-step-ids~="approve"]').length).toBe(2)
    expect(container.querySelector('[aria-label="Sample conversation"]')?.textContent).toContain('About the focused step')
    expect(container.querySelector('[aria-label="Sample conversation"]')?.textContent).toContain('Talking about Approve invoice')
    await click('Pick Match invoice to order')
    expect(container.querySelector('[aria-label="Sample conversation"]')?.textContent).not.toContain('About the focused step')
  })

  it('opens the record behind a conversation card in context', async () => {
    await click('Pick Match invoice to order')
    await click('Options and trade-offs')
    expect(context()?.querySelector('h2')?.textContent).toBe('Pay suppliers on time, without weakening controls')
    expect(container.querySelector('[data-record-id="control"] button')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps the step in focus when the opened record concerns it', async () => {
    await click('Pick Approve invoice')
    await click('See both accounts')
    expect(context()?.querySelector('h2')?.textContent).toBe('Approve invoice')
    expect(container.querySelector('[data-record-id="approval-evidence"] button')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('jumps from a record to the other map steps it concerns', async () => {
    await clickRecord('match-risk')
    await click('Show Match invoice to order on map')
    expect(mapStep('match').getAttribute('data-selected')).toBe('true')
    expect(context()?.querySelector('h2')?.textContent).toBe('Match invoice to order')
  })

  it('groups open work under the issue it serves and keeps settled decisions collapsed', async () => {
    for (const title of ['Resolve approver cover', 'Reduce repeated supplier chasing', 'Measure the payment outcome']) {
      expect(context()?.textContent).toContain(title)
    }
    expect(container.querySelector('[data-record-id="scope"]')).toBeNull()
    await click('Settled (1)')
    expect(container.querySelector('[data-record-id="scope"]')?.textContent).toContain('Supplier onboarding stays outside')
  })

  it('accepts a sample proposal locally and reset restores it', async () => {
    expect(container.querySelector('[aria-label="Open items"] [data-record-id="control"]')).not.toBeNull()
    await click('Accept sample')
    expect(container.textContent).not.toContain('Sample map proposal')
    expect(container.querySelector('[aria-label="Open items"] [data-record-id="control"]')).toBeNull()
    await click('Settled (2)')
    expect(container.querySelector('[data-record-id="control"]')?.textContent).toContain('Accepted locally')
    await click('Reset sample')
    expect(container.querySelector('[aria-label="Open items"] [data-record-id="control"]')?.textContent).toContain('Proposed')
    expect(container.textContent).toContain('Sample map proposal')
    expect(fetch).not.toHaveBeenCalled()
    expect(WebSocket).not.toHaveBeenCalled()
  })

  it('declines a proposal without presenting it as an agreed decision', async () => {
    await click('Decline')
    expect(container.textContent).toContain('No sample decision recorded')
    expect(context()?.textContent).not.toContain('Keep invoice approval separate from payment')
  })

  it('adds a local note without fabricating an AI reply', async () => {
    await enter('Local design note', 'I want more room for the map.')
    await click('Add local design note')
    expect(container.textContent).toContain('Your local design note')
    expect(container.textContent).toContain('I want more room for the map.')
    expect(container.textContent).toContain('No model call made')
    expect(fetch).not.toHaveBeenCalled()
    expect(WebSocket).not.toHaveBeenCalled()
  })

  it('assigns a risk owner locally and discards it on reset', async () => {
    await clickRecord('cover-risk')
    await click('Assign sample owner')
    await enter('Sample risk owner', 'Maya Patel')
    await click('Save locally')
    expect(container.querySelector('[data-record-id="cover-risk"]')?.textContent).toContain('Maya Patel · late payment exposure')
    await click('Reset sample')
    expect(container.querySelector('[data-record-id="cover-risk"]')?.textContent).toContain('Owner unassigned')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('opens supporting evidence inline without losing step focus', async () => {
    await click('Pick Approve invoice')
    await clickRecord('alex')
    await click('Supporting evidence')
    const evidence = container.querySelector('[aria-label="Supporting evidence: Approval delay: two accounts, no verified timing"]')!
    expect(context()?.querySelector('h2')?.textContent).toBe('Approve invoice')
    expect(evidence.textContent).toContain('Both may describe different cases')
  })

  it('exports a labelled sample of the current local records, not a real sign-off', async () => {
    await click('Accept sample')
    await click('Download sample')
    expect(saveTextToFile).toHaveBeenCalledWith('SAMPLE-process-brief.md', expect.stringContaining('# SAMPLE ONLY'))
    expect(saveTextToFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('not project data or an actual sign-off'))
    expect(saveTextToFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('Accepted locally'))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows an honest empty state for a step with nothing open', async () => {
    await click('Pick Invoice received')
    expect(context()?.textContent).toContain('Nothing open on this step. This is not a sign-off.')
  })

  it('scopes records to a step without hiding whole-process records', () => {
    const disputed = SAMPLE_ENTRIES.find((entry) => entry.id === 'approval-evidence')!
    expect(inStepScope(disputed, 'approve')).toBe(true)
    expect(inStepScope(disputed, 'match')).toBe(false)
    expect(inStepScope(disputed, null)).toBe(true)
  })
  it('turns the right-hand context into the editor on double-click, keeping the map and conversation', async () => {
    await doubleClickStep('approve')
    expect(container.querySelector('aside[aria-label="Step properties"]')).not.toBeNull()
    expect(context()).toBeNull()
    expect(container.querySelector('[aria-label="Sample conversation"]')).not.toBeNull()
    expect(stepName()?.value).toBe('Approve invoice')
    expect(container.textContent).toContain('Assigned person')
    expect(container.textContent).toContain('Team')
    expect(container.querySelector('[aria-label="Sample process map"]')).not.toBeNull()
  })

  it('provides a selected-block properties action for keyboard and touch access', async () => {
    await click('Pick Approve invoice')
    await click('Edit')
    expect(container.querySelector('[aria-label="Step properties"]')).not.toBeNull()
    await click('Close properties')
    expect(context()?.querySelector('h2')?.textContent).toBe('Approve invoice')
  })

  it('saves name, person, team, system and duration to the local map', async () => {
    await doubleClickStep('approve')
    await enter('Step name', 'Review invoice')
    await select('Assigned person', 'Jo Morgan')
    await select('Team', 'Operations')
    await enter('System or tool', 'Finance portal')
    await enter('Duration', '3')
    await select('Duration unit', 'Hours')
    await click('Save sample')
    const block = container.querySelector('[data-step-id="approve"]')!
    expect(block.textContent).toContain('Review invoice')
    expect(block.textContent).toContain('Jo Morgan')
    expect(block.getAttribute('data-team')).toBe('operations')
    expect(Number(block.getAttribute('data-y'))).toBe(170 - LANE_HEIGHT)
    await doubleClickStep('approve')
    expect(container.textContent).toContain('Jo Morgan')
    expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('3')
    expect(container.textContent).toContain('Hours')
    await click('Cancel')
    await click('Whole process')
    await click('Download sample')
    expect(saveTextToFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('System: Finance portal'))
    expect(fetch).not.toHaveBeenCalled()
    expect(WebSocket).not.toHaveBeenCalled()
  })

  it('cancel discards unsaved changes and reset restores saved sample properties', async () => {
    await doubleClickStep('approve')
    await enter('Step name', 'Unsaved name')
    await click('Cancel')
    expect(container.querySelector('[data-step-id="approve"]')?.textContent).toContain('Approve invoice')
    await doubleClickStep('approve')
    await enter('Step name', 'Saved name')
    await click('Save sample')
    expect(container.querySelector('[data-step-id="approve"]')?.textContent).toContain('Saved name')
    await click('Reset sample')
    expect(container.querySelector('[data-step-id="approve"]')?.textContent).toContain('Approve invoice')
  })

  it('protects a dirty draft when switching blocks and when returning to context', async () => {
    await doubleClickStep('approve')
    await enter('Step name', 'In progress')
    await doubleClickStep('resolve')
    expect(container.textContent).toContain('You have unsaved sample changes')
    await click('Keep editing')
    expect(stepName()?.value).toBe('In progress')
    await click('Close properties')
    expect(container.textContent).toContain('You have unsaved sample changes')
    await click('Discard changes')
    expect(container.querySelector('[aria-label="Step properties"]')).toBeNull()
    expect(context()).not.toBeNull()
    expect(container.querySelector('[data-step-id="approve"]')?.textContent).toContain('Approve invoice')
  })

  it('rejects a blank step name and invalid duration without changing the block', async () => {
    await doubleClickStep('approve')
    await enter('Step name', '   ')
    await click('Save sample')
    expect(container.textContent).toContain('Enter a step name.')
    await enter('Step name', 'Approve invoice')
    await enter('Duration', '-1')
    await click('Save sample')
    expect(container.textContent).toContain('Duration must be a number greater than zero')
    expect(container.querySelector('[aria-label="Step properties"]')).not.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('allows clearing assignment and duration without inventing values', async () => {
    await doubleClickStep('approve')
    await select('Assigned person', 'Unassigned')
    await enter('Duration', '')
    await click('Save sample')
    expect(container.querySelector('[data-assignee="approve"]')?.textContent).toBe('Budget owner')
    await doubleClickStep('approve')
    expect(container.querySelector('[aria-label="Assigned person"]')?.textContent).toBe('Unassigned')
    expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('')
  })

  it('discards a dirty draft explicitly before opening a different block', async () => {
    await doubleClickStep('approve')
    await enter('Step name', 'Do not save this')
    await doubleClickStep('resolve')
    await click('Discard changes')
    expect(stepName()?.value).toBe('Resolve mismatch')
    expect(container.querySelector('[data-step-id="approve"]')?.textContent).toContain('Approve invoice')
  })

  it('Escape protects a dirty inspector and leaves a clean inspector', async () => {
    const escape = async () => {
      await act(async () => stepName()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    }
    await doubleClickStep('approve')
    await enter('Step name', 'Unsaved name')
    await escape()
    expect(container.textContent).toContain('You have unsaved sample changes')
    await click('Keep editing')
    expect(stepName()?.value).toBe('Unsaved name')
    await escape()
    await click('Discard changes')
    expect(container.querySelector('[aria-label="Step properties"]')).toBeNull()
    await doubleClickStep('approve')
    await escape()
    expect(container.querySelector('[aria-label="Step properties"]')).toBeNull()
  })

  it('uses an accessible modal sheet on smaller screens without replacing workspace content', async () => {
    vi.mocked(window.matchMedia).mockImplementation((media) => mediaQuery(media, true))
    await act(async () => root.render(<TooltipProvider><DesignReview /></TooltipProvider>))
    await doubleClickStep('approve')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Step properties')
    expect(stepName()?.value).toBe('Approve invoice')
    expect(context()).not.toBeNull()
    expect(container.querySelector('[aria-label="Sample process map"]')).not.toBeNull()
    await select('Assigned person', 'Jo Morgan')
    expect(document.querySelector('[role="dialog"] [aria-label="Assigned person"]')?.textContent).toBe('Jo Morgan')
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close properties"]')!.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('You have unsaved sample changes')
    const discard = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Discard changes')!
    await act(async () => discard.click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('preserves a property draft when resizing between the inspector and sheet', async () => {
    let compact = false
    const query = { ...mediaQuery('(width < 80rem)', false), get matches() { return compact } }
    vi.mocked(window.matchMedia).mockImplementation((media) => media === query.media ? query : mediaQuery(media, false))
    await doubleClickStep('approve')
    await enter('Step name', 'Draft survives resizing')
    const listener = vi.mocked(query.addEventListener).mock.calls.find(([event]) => event === 'change')![1]
    const resize = async (next: boolean) => {
      await act(async () => {
        compact = next
        if (typeof listener === 'function') listener.call(query, new Event('change'))
        else listener.handleEvent(new Event('change'))
      })
    }
    await resize(true)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(stepName()?.value).toBe('Draft survives resizing')
    await resize(false)
    expect(container.querySelector('aside[aria-label="Step properties"]')).not.toBeNull()
    expect(stepName()?.value).toBe('Draft survives resizing')
    await click('Cancel')
    expect(query.removeEventListener).toHaveBeenCalledWith('change', listener)
  })
})
