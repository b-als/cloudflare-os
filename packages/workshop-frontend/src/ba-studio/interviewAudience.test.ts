import { describe, expect, it } from 'vitest'
import type { OpenQuestion, Stakeholder } from '@gadgets/gatekeeper-process/types'
import {
  isCurrentInterviewTarget,
  questionsForUser,
  stakeholderForUser,
  unansweredAsksByPerson,
} from './interviewAudience'

const stakeholders: Stakeholder[] = [
  { stakeholderId: 's-ops', name: 'Ops', role: 'Ops', stance: 'neutral', userId: 'u-ops' },
  { stakeholderId: 's-kyc', name: 'KYC', role: 'KYC', stance: 'sceptic' },
]

const questions: OpenQuestion[] = [
  { questionId: 'q1', text: 'Happy path?', raisedAt: 1, nodeIds: [], assigneeStakeholderId: 's-ops' },
  { questionId: 'q2', text: 'Exceptions?', raisedAt: 2, nodeIds: [], assigneeUserId: 'u-ops' },
  { questionId: 'q3', text: 'Controls?', raisedAt: 3, nodeIds: [], assigneeStakeholderId: 's-kyc' },
  { questionId: 'q4', text: 'Unassigned', raisedAt: 4, nodeIds: [] },
]

describe('interviewAudience', () => {
  it('collects questions assigned to a linked user', () => {
    expect(questionsForUser(questions, stakeholders, 'u-ops').map((q) => q.questionId)).toEqual([
      'q1',
      'q2',
    ])
    expect(questionsForUser(questions, stakeholders, 'u-other')).toEqual([])
  })

  it('detects the interview target by linked userId', () => {
    expect(isCurrentInterviewTarget(stakeholders, 's-ops', 'u-ops')).toBe(true)
    expect(isCurrentInterviewTarget(stakeholders, 's-ops', 'u-other')).toBe(false)
    expect(isCurrentInterviewTarget(stakeholders, 's-kyc', 'u-ops')).toBe(false)
    expect(stakeholderForUser(stakeholders, 'u-ops')?.stakeholderId).toBe('s-ops')
  })

  it('surfaces unanswered asks per person', () => {
    const rows = unansweredAsksByPerson(questions, stakeholders)
    expect(rows).toEqual([
      { stakeholderId: 's-ops', userId: 'u-ops', name: 'Ops', count: 2 },
      { stakeholderId: 's-kyc', name: 'KYC', count: 1 },
    ])
  })
})
