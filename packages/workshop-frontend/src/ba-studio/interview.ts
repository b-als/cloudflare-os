import type { StageId } from './prototype'

const STAGE_QUESTION: Record<StageId, string> = {
  outcomes: 'Ask what problem this process is for, how it will be measured, and the date that measure should be met.',
  stakeholders: 'Ask who cares about the outcome, how much influence and interest they have, and who owns each future-state step.',
  'as-is': 'Ask them to walk the current map: what starts it, who does each step, and where it hurts.',
  requirements: 'Ask for one testable requirement, which outcome it serves, and whether it is a must.',
  'to-be': 'Ask what the future-state step should do differently, including exceptions and how long it should take.',
  tradeoffs: 'Ask which option is being chosen and why, against the outcomes it affects.',
  validate: 'Ask them to walk one path and say what actually happened, including anything that failed.',
  signoff: 'Ask whether the captured baseline is ready for a person to review, and what note should go with that decision. Do not approve it yourself.',
  handoff: 'Ask who owns the next piece of work and which requirements it covers.',
  monitor: 'Ask for one sourced measurement against an outcome. Do not invent a reading.',
}

/** First message when a BA project has no conversation yet. */
export function interviewOpening(processName: string): string {
  return [
    `You are the business analyst. I do the work on "${processName}".`,
    'Read PROCESS_PROJECT.getContext().',
    'Ask me one question about the first coverage hint or validation gap that is still open.',
    'Write only what I confirm, using applyChanges.',
    'Do not invent scope, owners, or measurements.',
  ].join(' ')
}

/** Continuation for the stage the person is looking at. Same chat, same project. */
export function stageAskPrompt(stage: StageId, processName: string): string {
  return [
    `Stay on "${processName}".`,
    'Read PROCESS_PROJECT.getContext() and skip anything already filled.',
    STAGE_QUESTION[stage],
    'Ask me one question, then save only what I confirm with applyChanges.',
  ].join(' ')
}
