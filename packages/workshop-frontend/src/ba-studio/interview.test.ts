import { describe, expect, it } from 'vitest'
import type { StageId } from './prototype'
import { STAGES } from './stages'
import { interviewOpening, stageAskPrompt } from './interview'

const STAGES_IDS = STAGES.map((stage) => stage.id)

describe('interview prompts', () => {
  it('opens by interviewing the person who does the work, whatever is already on the map', () => {
    const opening = interviewOpening('Invoice approval')
    expect(opening).toContain('You are the business analyst')
    expect(opening).toContain('I do the work on "Invoice approval"')
    expect(opening).toContain('PROCESS_PROJECT.getContext()')
    expect(opening).toContain('one question')
    expect(opening).toContain('applyChanges')
    expect(opening).toContain('Do not invent scope, owners, or measurements')
  })

  it('asks about the open stage and tells the analyst to skip what is already saved', () => {
    for (const stage of STAGES_IDS) {
      const prompt = stageAskPrompt(stage, 'Invoice approval')
      expect(prompt).toContain('Stay on "Invoice approval"')
      expect(prompt).toContain('skip anything already filled')
      expect(prompt).toContain('Ask me one question')
      expect(prompt).toContain('applyChanges')
    }
    expect(stageAskPrompt('outcomes', 'Invoice approval')).toContain('date')
    expect(stageAskPrompt('stakeholders', 'Invoice approval')).toContain('future-state step')
    expect(stageAskPrompt('as-is', 'Invoice approval')).toContain('current map')
    expect(stageAskPrompt('requirements', 'Invoice approval')).toContain('must')
    expect(stageAskPrompt('to-be', 'Invoice approval')).toContain('exceptions')
    expect(stageAskPrompt('tradeoffs', 'Invoice approval')).toContain('option')
    expect(stageAskPrompt('validate', 'Invoice approval')).toContain('what actually happened')
    expect(stageAskPrompt('signoff', 'Invoice approval')).toContain('Do not approve it yourself')
    expect(stageAskPrompt('handoff', 'Invoice approval')).toContain('who owns')
    expect(stageAskPrompt('monitor', 'Invoice approval')).toContain('sourced measurement')
  })

  it('covers every stage id', () => {
    const seen = new Set<StageId>(STAGES_IDS)
    expect(seen.size).toBe(STAGES.length)
  })
})
