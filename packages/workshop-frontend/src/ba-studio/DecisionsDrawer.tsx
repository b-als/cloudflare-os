import { useState } from 'react'
import { CheckCircle, Question, Users, X } from '@phosphor-icons/react'
import type {
  Decision,
  OpenQuestion,
  Stakeholder,
  StakeholderInput,
  StakeholderStance,
} from '@gadgets/gatekeeper-process/types'
import type { AiChatAuthorInfo } from '@gadgets/workshop-shared/api'
import { Card, Pill, type Tone } from './ui'

const STANCES: StakeholderStance[] = ['champion', 'supporter', 'neutral', 'sceptic']

const STANCE_TONE: Record<StakeholderStance, Tone> = {
  champion: 'success',
  supporter: 'info',
  neutral: 'neutral',
  sceptic: 'warning',
}

function AnswerForm({ onSubmit }: { onSubmit: (answer: string) => void }) {
  const [answer, setAnswer] = useState('')
  return (
    <form
      className="mt-2 flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!answer.trim()) return
        onSubmit(answer.trim())
        setAnswer('')
      }}
    >
      <input
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        placeholder="Answer this question…"
        className="h-8 min-w-0 flex-1 rounded-lg border border-kumo-line bg-kumo-base px-2.5 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand"
      />
      <button
        type="submit"
        disabled={!answer.trim()}
        className="h-8 rounded-lg bg-kumo-brand px-2.5 text-[12.5px] font-medium text-white hover:bg-kumo-brand-hover disabled:opacity-60"
      >
        Answer
      </button>
    </form>
  )
}

type Participant = {
  key: string
  stakeholderId?: string
  name: string
  role?: string
  stance?: StakeholderStance
  isInterviewTarget: boolean
  questions: OpenQuestion[]
}

function buildParticipants(
  stakeholders: Stakeholder[],
  openQuestions: OpenQuestion[],
  workspacePeople: AiChatAuthorInfo[],
  interviewTargetStakeholderId: string | null,
): { participants: Participant[]; unassigned: OpenQuestion[] } {
  const byStakeholder = new Map<string, OpenQuestion[]>()
  const byUser = new Map<string, OpenQuestion[]>()
  const unassigned: OpenQuestion[] = []
  for (const question of openQuestions) {
    if (question.assigneeStakeholderId) {
      const list = byStakeholder.get(question.assigneeStakeholderId) ?? []
      list.push(question)
      byStakeholder.set(question.assigneeStakeholderId, list)
    } else if (question.assigneeUserId) {
      const list = byUser.get(question.assigneeUserId) ?? []
      list.push(question)
      byUser.set(question.assigneeUserId, list)
    } else {
      unassigned.push(question)
    }
  }

  const participants: Participant[] = stakeholders.map((person) => ({
    key: `s:${person.stakeholderId}`,
    stakeholderId: person.stakeholderId,
    name: person.name,
    role: person.role,
    stance: person.stance,
    isInterviewTarget: person.stakeholderId === interviewTargetStakeholderId,
    questions: byStakeholder.get(person.stakeholderId) ?? [],
  }))

  const registerUserIds = new Set(
    stakeholders.map((person) => person.userId).filter((id): id is string => id !== undefined),
  )
  for (const [userId, questions] of byUser) {
    if (registerUserIds.has(userId)) continue
    const profile = workspacePeople.find((person) => person.id === userId)
    participants.push({
      key: `u:${userId}`,
      name: profile?.name ?? userId,
      role: 'Workspace collaborator',
      isInterviewTarget: false,
      questions,
    })
  }

  participants.sort((a, b) => {
    if (a.isInterviewTarget !== b.isInterviewTarget) return a.isInterviewTarget ? -1 : 1
    if ((a.questions.length > 0) !== (b.questions.length > 0)) return a.questions.length > 0 ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return { participants, unassigned }
}

function QuestionItem({
  question,
  readOnly,
  onResolve,
}: {
  question: OpenQuestion
  readOnly: boolean
  onResolve: (questionId: string, answer: string) => void
}) {
  return (
    <li className="rounded-lg border border-kumo-line px-2.5 py-2">
      <p className="text-[12.5px] text-kumo-default">{question.text}</p>
      {!readOnly && <AnswerForm onSubmit={(answer) => onResolve(question.questionId, answer)} />}
    </li>
  )
}

function AddStakeholderForm({
  workspacePeople,
  onAdd,
}: {
  workspacePeople: AiChatAuthorInfo[]
  onAdd: (input: StakeholderInput) => void
}) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [stance, setStance] = useState<StakeholderStance>('neutral')
  const [userId, setUserId] = useState('')

  return (
    <form
      className="mt-3 flex flex-col gap-2 rounded-lg border border-dashed border-kumo-line px-2.5 py-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!name.trim() || !role.trim()) return
        const input: StakeholderInput = { name: name.trim(), role: role.trim(), stance }
        if (userId) input.userId = userId
        onAdd(input)
        setName('')
        setRole('')
        setStance('neutral')
        setUserId('')
      }}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-kumo-inactive">Add to register</p>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name"
        className="h-8 rounded-lg border border-kumo-line bg-kumo-base px-2.5 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand"
      />
      <input
        value={role}
        onChange={(event) => setRole(event.target.value)}
        placeholder="Role (e.g. KYC lead)"
        className="h-8 rounded-lg border border-kumo-line bg-kumo-base px-2.5 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand"
      />
      <div className="flex gap-2">
        <select
          value={stance}
          onChange={(event) => setStance(event.target.value as StakeholderStance)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand"
        >
          {STANCES.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand"
        >
          <option value="">No workspace link</option>
          {workspacePeople.map((person) => (
            <option key={person.id} value={person.id}>{person.name}</option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={!name.trim() || !role.trim()}
        className="h-8 rounded-lg bg-kumo-brand px-2.5 text-[12.5px] font-medium text-white hover:bg-kumo-brand-hover disabled:opacity-60"
      >
        Add person
      </button>
    </form>
  )
}

export type DecisionsDrawerProps = {
  decisions: Decision[]
  openQuestions: OpenQuestion[]
  stakeholders: Stakeholder[]
  interviewTargetStakeholderId: string | null
  workspacePeople: AiChatAuthorInfo[]
  readOnly: boolean
  onResolve: (questionId: string, answer: string) => void
  onUpsertStakeholder?: (input: StakeholderInput) => void
  onRemoveStakeholder?: (stakeholderId: string) => void
  onSetInterviewTarget?: (stakeholderId: string | null) => void
  onClose: () => void
}

/** Side drawer listing people to interview, open questions, and the decision log. */
export default function DecisionsDrawer({
  decisions,
  openQuestions,
  stakeholders,
  interviewTargetStakeholderId,
  workspacePeople,
  readOnly,
  onResolve,
  onUpsertStakeholder,
  onRemoveStakeholder,
  onSetInterviewTarget,
  onClose,
}: DecisionsDrawerProps) {
  const { participants, unassigned } = buildParticipants(
    stakeholders,
    openQuestions,
    workspacePeople,
    interviewTargetStakeholderId,
  )
  const interviewTarget = participants.find((person) => person.isInterviewTarget)
  const canEditRegister = !readOnly && !!onUpsertStakeholder

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[360px] flex-col overflow-y-auto border-l border-kumo-line bg-kumo-elevated shadow-xl">
      <header className="flex items-center justify-between gap-2 border-b border-kumo-line px-4 py-3">
        <h2 className="text-[14px] font-semibold text-kumo-default">Decisions & questions</h2>
        <button type="button" onClick={onClose} title="Close" className="rounded-md p-1 text-kumo-subtle hover:bg-kumo-tint">
          <X size={16} />
        </button>
      </header>

      <div className="flex flex-col gap-4 p-4">
        <Card
          eyebrow={`${participants.length} people · ${openQuestions.length} open`}
          title={
            <span className="inline-flex items-center gap-1.5">
              <Users size={14} />
              Interview participants
            </span>
          }
        >
          {interviewTarget && (
            <p className="mb-3 text-[12px] text-kumo-subtle">
              Ask next: <span className="font-medium text-kumo-default">{interviewTarget.name}</span>
              {!readOnly && onSetInterviewTarget && (
                <button
                  type="button"
                  className="ml-2 text-kumo-brand hover:underline"
                  onClick={() => onSetInterviewTarget(null)}
                >
                  Clear
                </button>
              )}
            </p>
          )}
          {participants.length === 0 && unassigned.length === 0 ? (
            <p className="text-[12.5px] text-kumo-subtle">
              No stakeholders yet. Add people below, or let the agent update the register while interviewing.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {participants.map((person) => (
                <li key={person.key} className="rounded-lg border border-kumo-line px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[12.5px] font-medium text-kumo-default">{person.name}</p>
                    {person.stance && <Pill tone={STANCE_TONE[person.stance]}>{person.stance}</Pill>}
                    {person.isInterviewTarget && <Pill tone="info">Ask next</Pill>}
                    {person.questions.length > 0 && (
                      <Pill tone="warning">{person.questions.length} open</Pill>
                    )}
                  </div>
                  {person.role && <p className="mt-0.5 text-[12px] text-kumo-subtle">{person.role}</p>}
                  {person.stakeholderId && !readOnly && (onSetInterviewTarget || onRemoveStakeholder) && (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {onSetInterviewTarget && !person.isInterviewTarget && (
                        <button
                          type="button"
                          className="text-[11.5px] font-medium text-kumo-brand hover:underline"
                          onClick={() => onSetInterviewTarget(person.stakeholderId!)}
                        >
                          Ask next
                        </button>
                      )}
                      {onRemoveStakeholder && (
                        <button
                          type="button"
                          className="text-[11.5px] font-medium text-kumo-danger hover:underline"
                          onClick={() => onRemoveStakeholder(person.stakeholderId!)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                  {person.questions.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-2">
                      {person.questions.map((question) => (
                        <QuestionItem
                          key={question.questionId}
                          question={question}
                          readOnly={readOnly}
                          onResolve={onResolve}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEditRegister && (
            <AddStakeholderForm workspacePeople={workspacePeople} onAdd={onUpsertStakeholder} />
          )}
        </Card>

        {unassigned.length > 0 && (
          <Card
            eyebrow={`${unassigned.length} unassigned`}
            title={
              <span className="inline-flex items-center gap-1.5">
                <Question size={14} />
                Open questions
              </span>
            }
          >
            <ul className="flex flex-col gap-3">
              {unassigned.map((question) => (
                <QuestionItem
                  key={question.questionId}
                  question={question}
                  readOnly={readOnly}
                  onResolve={onResolve}
                />
              ))}
            </ul>
          </Card>
        )}

        <Card
          eyebrow={`${decisions.length} recorded`}
          title={
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle size={14} />
              Decision log
            </span>
          }
        >
          {decisions.length === 0 ? (
            <p className="text-[12.5px] text-kumo-subtle">Nothing decided yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {decisions.map((decision) => (
                <li key={decision.decisionId} className="rounded-lg border border-kumo-line px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[12.5px] font-medium text-kumo-default">{decision.summary}</p>
                    {decision.status === 'superseded' ? (
                      <Pill tone="neutral">Superseded</Pill>
                    ) : decision.locked ? (
                      <Pill tone="warning">Locked</Pill>
                    ) : (
                      <Pill tone="success">Active</Pill>
                    )}
                  </div>
                  {decision.rationale && <p className="mt-0.5 text-[12px] text-kumo-subtle">{decision.rationale}</p>}
                  <p className="mt-1 text-[11px] text-kumo-inactive">{new Date(decision.decidedAt).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
