// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import type { GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import type { ProjectSnapshot } from '@gadgets/gatekeeper-process/ui-types'
import { emptyLifecycle } from '@gadgets/gatekeeper-process/lifecycle'
import LifecyclePanel from './LifecyclePanel'

vi.mock('../errorReporting', () => ({ reportIssue: vi.fn<typeof import('../errorReporting').reportIssue>() }))
class AccountApi extends RpcTarget {
  async getGatekeeperApp(_appId: string): Promise<GatekeeperUiFrame | null> { return null }
}
const api = new RpcStub(new AccountApi())
const unusedBaseline = async () => { throw new Error('Not used by artifact editors.') }
type Save = Parameters<typeof LifecyclePanel>[0]['save']
let container: HTMLDivElement
let root: Root | undefined
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => api[Symbol.dispose]())
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
})

async function render(node: ReactNode) {
  if (!root) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => root!.render(node))
}
async function clickButton(name: string) {
  const button = [...container.querySelectorAll('button')].find((entry) => entry.textContent === name)
  if (!button) throw new Error(`Button "${name}" not found.`)
  await act(async () => button.click())
}
async function input(label: string, value: string) {
  const element = container.querySelector(`[aria-label="${label}"]`)
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
    element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!element || !setter) throw new Error(`Input "${label}" not found.`)
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
function snapshot(revision = 9): ProjectSnapshot {
  return {
    projectId: 'actual-project', name: 'Review', graph: { revision, lanes: [], nodes: [], edges: [] },
    decisions: [], openQuestions: [], stakeholders: [], interviewTargetStakeholderId: null, takeaways: [],
    lifecycle: emptyLifecycle(revision),
  }
}

describe('live BA lifecycle editor', () => {
  it('saves measurable outcomes with the displayed project revision', async () => {
    const save = vi.fn<Save>(async () => {})
    await render(<LifecyclePanel stage="outcomes" snapshot={snapshot()} api={api}
      busy={false} save={save} createBaseline={unusedBaseline} />)
    await clickButton('Add outcome')
    await input('Title', 'Faster reviews')
    await input('Metric', 'Review duration')
    await input('Unit', 'hours')
    await input('Baseline', '4')
    await input('Target', '2')
    await input('Direction', 'decrease')
    await clickButton('Save artifact')
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0]?.[0][0]).toMatchObject({
      op: 'putArtifact',
      artifact: { kind: 'outcome', title: 'Faster reviews', metric: 'Review duration',
        unit: 'hours', baseline: 4, target: 2, direction: 'decrease' },
    })
    expect(save.mock.calls[0]?.[1]).toBe(9)
  })

  it('preserves the form revision across remote updates and surfaces save conflicts', async () => {
    const save = vi.fn<Save>(async () => { throw new Error('Project changed; reopen the artifact.') })
    await render(<LifecyclePanel stage="outcomes" snapshot={snapshot()} api={api}
      busy={false} save={save} createBaseline={unusedBaseline} />)
    await clickButton('Add outcome')
    await input('Title', 'My unsaved draft')
    await render(<LifecyclePanel stage="outcomes" snapshot={snapshot(10)} api={api}
      busy={false} save={save} createBaseline={unusedBaseline} />)
    await clickButton('Save artifact')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Project changed')
    expect(save.mock.calls[0]?.[1]).toBe(9)
    expect(container.querySelector('[aria-label="Title"]')).toHaveProperty('value', 'My unsaved draft')
  })

  it('selects traceability links by meaningful labels rather than requiring copied IDs', async () => {
    const state = snapshot()
    state.lifecycle = {
      ...emptyLifecycle(9),
      artifacts: [
        { kind: 'outcome', id: 'speed', title: 'Speed', metric: 'Time', unit: 'hours', baseline: 4, target: 2, direction: 'decrease' },
        { kind: 'stakeholder', id: 'ops', title: 'Operations', role: 'Owner', notes: '' },
      ],
      toBe: { revision: 1, lanes: [{ id: 'lane', label: 'Operations' }], edges: [],
        nodes: [{ id: 'check', label: 'Review', type: 'userTask', laneId: 'lane', x: 0, y: 0 }] },
    }
    const save = vi.fn<Save>(async () => {})
    await render(<LifecyclePanel stage="requirements" snapshot={state} api={api}
      busy={false} save={save} createBaseline={unusedBaseline} />)
    await clickButton('Add requirement')
    await input('Title', 'Review requests')
    for (const label of ['outcomeIds: Speed', 'stakeholderIds: Operations', 'nodeIds: Review']) {
      const checkbox = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)
      if (!checkbox) throw new Error(`Checkbox "${label}" not found.`)
      await act(async () => checkbox.click())
    }
    await clickButton('Save artifact')
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0]?.[0][0]).toMatchObject({
      op: 'putArtifact', artifact: { kind: 'requirement', outcomeIds: ['speed'], stakeholderIds: ['ops'], nodeIds: ['check'] },
    })
  })
})
