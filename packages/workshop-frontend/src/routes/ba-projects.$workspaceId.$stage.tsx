import type { ComponentType } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { isStageId } from '../ba-studio/stages'
import type { StageId } from '../ba-studio/prototype'
import OutcomesStage from '../ba-studio/stages/OutcomesStage'
import StakeholdersStage from '../ba-studio/stages/StakeholdersStage'
import AsIsStage from '../ba-studio/stages/AsIsStage'
import RequirementsStage from '../ba-studio/stages/RequirementsStage'
import ToBeStage from '../ba-studio/stages/ToBeStage'
import TradeoffsStage from '../ba-studio/stages/TradeoffsStage'
import ValidateStage from '../ba-studio/stages/ValidateStage'
import SignoffStage from '../ba-studio/stages/SignoffStage'
import HandoffStage from '../ba-studio/stages/HandoffStage'
import MonitorStage from '../ba-studio/stages/MonitorStage'

const STAGE_SCREENS: Record<StageId, ComponentType> = {
  outcomes: OutcomesStage,
  stakeholders: StakeholdersStage,
  'as-is': AsIsStage,
  requirements: RequirementsStage,
  'to-be': ToBeStage,
  tradeoffs: TradeoffsStage,
  validate: ValidateStage,
  signoff: SignoffStage,
  handoff: HandoffStage,
  monitor: MonitorStage,
}

/** One stage screen of a BA Studio project, e.g. `/ba-projects/<id>/outcomes`. */
export const Route = createFileRoute('/ba-projects/$workspaceId/$stage')({
  component: StagePage,
})

function StagePage() {
  const { workspaceId, stage } = Route.useParams()
  if (!isStageId(stage)) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-kumo-subtle">
        Unknown stage “{stage}”.{' '}
        <Link to="/ba-projects/$workspaceId/$stage" params={{ workspaceId, stage: 'outcomes' }} className="text-kumo-brand hover:underline">
          Go to Outcomes
        </Link>
      </div>
    )
  }
  const Screen = STAGE_SCREENS[stage]
  return <Screen />
}
