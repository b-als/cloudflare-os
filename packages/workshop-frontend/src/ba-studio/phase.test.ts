import { describe, expect, it } from 'vitest'
import type { ProcessGraph, ProcessNode } from '@gadgets/gatekeeper-process/types'
import { phaseOf } from './phase'

const node = (id: string, type: ProcessNode['type'], extra: Partial<ProcessNode> = {}): ProcessNode => ({
  id, type, label: id, laneId: 'lane', x: 0, y: 0, ...extra,
})

function graph(nodes: ProcessNode[], edges: [string, string][] = []): ProcessGraph {
  return {
    revision: 1,
    lanes: [{ id: 'lane', label: 'Team' }],
    nodes,
    edges: edges.map(([source, target], index) => ({ id: `e${index}`, source, target })),
  }
}

describe('phaseOf', () => {
  it('is Understand until the process has a start and an end', () => {
    expect(phaseOf(graph([])).phase).toBe('understand')
    expect(phaseOf(graph([node('start', 'startEvent')])).phase).toBe('understand')
  })

  it('is Map once a draft exists, naming the next gap', () => {
    const drafted = graph(
      [node('start', 'startEvent'), node('do', 'userTask'), node('end', 'endEvent')],
      [['start', 'do'], ['do', 'end']],
    )
    expect(phaseOf(drafted)).toEqual({ phase: 'map', next: 'Exceptions: branches or alternate outcomes' })
  })

  it('is Improve once exceptions, people and friction are captured', () => {
    const mapped = graph(
      [
        node('start', 'startEvent'),
        node('do', 'userTask', { owner: 'Finance', painPoints: 'Manual re-keying' }),
        node('end', 'endEvent'),
        node('rejected', 'endEvent'),
      ],
      [['start', 'do'], ['do', 'end'], ['do', 'rejected']],
    )
    expect(phaseOf(mapped).phase).toBe('improve')
  })
})
