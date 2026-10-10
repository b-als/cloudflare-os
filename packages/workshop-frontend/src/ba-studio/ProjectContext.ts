import { createContext, useContext } from 'react'
import type { BaPrototypeProject, StageId } from './prototype'

/** What the traceability drawer is focused on. */
export type TraceFocus =
  | { type: 'outcome'; id: string }
  | { type: 'requirement'; id: string }
  | { type: 'node'; id: string }

export type ProjectContextValue = {
  project: BaPrototypeProject
  /** Opens the traceability drawer focused on an artifact. */
  trace: (focus: TraceFocus) => void
  /** Continues the project chat with one question about this stage. */
  askAboutStage: (stage: StageId) => void
  /** `live` reads a saved Process Studio project. `demo` is the worked example. */
  persistence: 'live' | 'demo'
}

export const ProjectContext = createContext<ProjectContextValue | null>(null)

export function useProject(): ProjectContextValue {
  const value = useContext(ProjectContext)
  if (!value) throw new Error('useProject must be used inside a BA Studio project layout')
  return value
}
