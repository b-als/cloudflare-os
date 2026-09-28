import { useState } from 'react'
import { CheckCircle, Question, X } from '@phosphor-icons/react'
import type { Decision, OpenQuestion } from '@gadgets/gatekeeper-process/types'
import { Card, Pill } from './ui'

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

export type DecisionsDrawerProps = {
  decisions: Decision[]
  openQuestions: OpenQuestion[]
  readOnly: boolean
  onResolve: (questionId: string, answer: string) => void
  onClose: () => void
}

/** Side drawer listing what has been decided and what stakeholders still need to answer. */
export default function DecisionsDrawer({ decisions, openQuestions, readOnly, onResolve, onClose }: DecisionsDrawerProps) {
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
          eyebrow={`${openQuestions.length} open`}
          title={
            <span className="inline-flex items-center gap-1.5">
              <Question size={14} />
              Open questions
            </span>
          }
        >
          {openQuestions.length === 0 ? (
            <p className="text-[12.5px] text-kumo-subtle">Nothing outstanding.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {openQuestions.map((question) => (
                <li key={question.questionId} className="rounded-lg border border-kumo-line px-2.5 py-2">
                  <p className="text-[12.5px] text-kumo-default">{question.text}</p>
                  {!readOnly && <AnswerForm onSubmit={(answer) => onResolve(question.questionId, answer)} />}
                </li>
              ))}
            </ul>
          )}
        </Card>

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
