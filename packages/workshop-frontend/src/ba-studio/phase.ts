import { computeCoverage, type CoverageItem } from '@gadgets/gatekeeper-process/coverage'
import type { ProcessGraph } from '@gadgets/gatekeeper-process/types'

/** The four stages the agent leads a person through. A progress indicator, never navigation. */
export type PhaseId = 'understand' | 'map' | 'improve' | 'ship'

export const PHASES: readonly { id: PhaseId; label: string }[] = [
  { id: 'understand', label: 'Understand' },
  { id: 'map', label: 'Map' },
  { id: 'improve', label: 'Improve' },
  { id: 'ship', label: 'Ship' },
]

/** Where a project is, and the gap the conversation is closing next. */
export type PhaseProgress = { phase: PhaseId; next?: string }

// What makes the current process "mapped": its boundaries are known, it runs end to end, and the
// exceptions, people and friction along the way are captured. Timing is improvement work.
const MAPPING_KEYS: ReadonlySet<CoverageItem['key']> = new Set([
  'happyPath', 'exceptions', 'rolesAndSystems', 'painPoints',
])

/**
 * Derives the phase from the map alone, so the indicator needs no bookkeeping of its own. Ship is
 * reached when an approved map runs as a Workflow, which the plan's Phase 6 builds.
 */
export function phaseOf(graph: ProcessGraph): PhaseProgress {
  const coverage = computeCoverage(graph)
  const scope = coverage.find((item) => item.key === 'scope')
  if (!scope?.done) return { phase: 'understand', next: 'Where the process starts and ends' }
  const gap = coverage.find((item) => MAPPING_KEYS.has(item.key) && !item.done)
  if (gap) return { phase: 'map', next: gap.label }
  return { phase: 'improve', next: 'The better process and its trade-offs' }
}
