// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactFlowProps } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProcessMap, { type ProcessMapProps } from './ProcessMap'

vi.mock('./../ThemeContext', () => ({ useTheme: () => ({ resolvedThemeMode: 'light' }) }))
vi.mock('@cloudflare/kumo', async (importOriginal) => ({
  ...await importOriginal<typeof import('@cloudflare/kumo')>(),
  useKumoToastManager: () => ({ add: vi.fn<() => void>() }),
}))
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('@xyflow/react')>(),
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: ({ nodes, onNodeDoubleClick }: ReactFlowProps) => (
    <div>{nodes?.map((node) => (
      <button key={node.id} data-node-id={node.id} data-editing={String(node.data.editing ?? false)} data-open={String(node.data.openItems ?? '')}
        onDoubleClick={(event) => onNodeDoubleClick?.(event, node)}>
        {node.id}
      </button>
    ))}</div>
  ),
  useReactFlow: () => ({ fitView: vi.fn<() => void>() }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('process map block activation', () => {
  let container: HTMLDivElement
  let root: Root
  const step = { id: 'step', type: 'userTask' as const, label: 'Review', laneId: 'team', x: 200, y: 30 }
  const graph = { revision: 1, lanes: [{ id: 'team', label: 'Finance' }], nodes: [step], edges: [] }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  const render = async (props: Partial<ProcessMapProps>) => {
    await act(async () => root.render(
      <ProcessMap graph={graph} preview={null} readOnly={false}
        onOps={() => ({ ok: true })} onTidy={() => {}} onPickStep={() => {}} {...props} />,
    ))
  }
  const doubleClick = async (id: string) => {
    const node = container.querySelector(`[data-node-id="${id}"]`)!
    await act(async () => node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  }

  it('opens host properties for a committed block on a read-only canvas', async () => {
    const open = vi.fn<NonNullable<ProcessMapProps['onOpenStepProperties']>>()
    await render({ readOnly: true, onOpenStepProperties: open })
    await doubleClick('step')
    expect(open).toHaveBeenCalledWith(step)
    expect(container.querySelector('[data-node-id="step"]')?.getAttribute('data-editing')).toBe('false')
  })

  it('keeps inline rename for editable production callers without an inspector', async () => {
    await render({})
    await doubleClick('step')
    expect(container.querySelector('[data-node-id="step"]')?.getAttribute('data-editing')).toBe('true')
  })

  it('keeps read-only production callers inert on double-click', async () => {
    await render({ readOnly: true })
    await doubleClick('step')
    expect(container.querySelector('[data-node-id="step"]')?.getAttribute('data-editing')).toBe('false')
  })

  it('passes open-item counts to committed steps', async () => {
    await render({ openItemCounts: { step: 3 } })
    expect(container.querySelector('[data-node-id="step"]')?.getAttribute('data-open')).toBe('3')
  })

  it('does not open properties for a lane or a pending, uncommitted block', async () => {
    const open = vi.fn<NonNullable<ProcessMapProps['onOpenStepProperties']>>()
    await render({
      readOnly: true, onOpenStepProperties: open,
      preview: {
        addedLanes: [], addedNodes: [{ ...step, id: 'pending' }], addedEdges: [],
        removedNodeIds: [], removedEdgeIds: [], changedNodeIds: [], changedEdgeIds: [],
      },
    })
    const lane = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent !== 'step' && item.textContent !== 'pending')!
    await act(async () => lane.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    await doubleClick('pending')
    expect(open).not.toHaveBeenCalled()
  })
})
