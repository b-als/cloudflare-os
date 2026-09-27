import type { ReactNode } from 'react'
import {
  ChartLineUp,
  FlowArrow,
  ListChecks,
  PlayCircle,
  Rocket,
  Scales,
  SealCheck,
  Target,
  TreeStructure,
  UsersThree,
} from '@phosphor-icons/react'
import type { StageId } from './prototype'

export type StageDefinition = {
  id: StageId
  label: string
  /** The recognised practice the agent follows at this stage. */
  method: string
  description: string
  icon: (size: number) => ReactNode
  /** Future stages are shown but flagged as not yet part of the core flow. */
  future?: boolean
}

/** The end-to-end BA Studio journey, in order. */
export const STAGES: StageDefinition[] = [
  {
    id: 'outcomes',
    label: 'Outcomes',
    method: 'BABOK Strategy Analysis · SMART',
    description: 'Frame the problem, target outcomes and the measures that prove them.',
    icon: (size) => <Target size={size} />,
  },
  {
    id: 'stakeholders',
    label: 'Stakeholders',
    method: 'Power/interest grid · RACI',
    description: 'Map who matters, find who is missing, and draft accountability.',
    icon: (size) => <UsersThree size={size} />,
  },
  {
    id: 'as-is',
    label: 'Current state',
    method: 'SIPOC · BPMN 2.0 · Lean waste',
    description: 'Scope the process, model it as it runs today and cost the pain.',
    icon: (size) => <TreeStructure size={size} />,
  },
  {
    id: 'requirements',
    label: 'Requirements',
    method: 'BABOK Elicitation · MoSCoW',
    description: 'Elicit testable requirements, each traced to an outcome.',
    icon: (size) => <ListChecks size={size} />,
  },
  {
    id: 'to-be',
    label: 'Future state',
    method: 'BPMN 2.0 · DMN',
    description: 'Design the target process, decisions, exceptions and SLAs.',
    icon: (size) => <FlowArrow size={size} />,
  },
  {
    id: 'tradeoffs',
    label: 'Trade-offs',
    method: 'Weighted options analysis',
    description: 'Resolve conflicts and choose options by impact on outcomes.',
    icon: (size) => <Scales size={size} />,
  },
  {
    id: 'validate',
    label: 'Validate',
    method: 'Walkthrough · simulation',
    description: 'Walk the process, project the measures and close the gaps.',
    icon: (size) => <PlayCircle size={size} />,
  },
  {
    id: 'signoff',
    label: 'Sign-off',
    method: 'Baseline & change control',
    description: 'Approve a versioned baseline and see what changed.',
    icon: (size) => <SealCheck size={size} />,
  },
  {
    id: 'handoff',
    label: 'Hand-off & build',
    method: 'BPMN XML · user stories',
    description: 'Export the design and turn it into something that runs.',
    icon: (size) => <Rocket size={size} />,
  },
  {
    id: 'monitor',
    label: 'Monitor',
    method: 'Benefits realisation',
    description: 'Track actual against target after go-live.',
    icon: (size) => <ChartLineUp size={size} />,
    future: true,
  },
]

export function isStageId(value: string): value is StageId {
  return STAGES.some((stage) => stage.id === value)
}

export function stageIndex(id: StageId): number {
  return STAGES.findIndex((stage) => stage.id === id)
}
