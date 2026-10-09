import { Question, UserFocus } from '@phosphor-icons/react'
import type { OpenQuestion } from '@gadgets/gatekeeper-process/types'
import { Pill } from './ui'

export type InterviewAudienceBannerProps = {
  /** True when this user is the project's ask-next interview target. */
  beingInterviewed: boolean
  questionsForYou: OpenQuestion[]
  onOpenQuestions: () => void
}

/**
 * Shown when a collaborator opens a process project and they are the interview target
 * and/or have unanswered assigned questions.
 */
export const InterviewAudienceBanner = ({
  beingInterviewed,
  questionsForYou,
  onOpenQuestions,
}: InterviewAudienceBannerProps) => {
  if (!beingInterviewed && questionsForYou.length === 0) return null

  const title = beingInterviewed
    ? "You're being interviewed"
    : 'Questions for you'
  const body = beingInterviewed
    ? questionsForYou.length > 0
      ? `The BA agent will ask you next. You have ${questionsForYou.length} unanswered question${questionsForYou.length === 1 ? '' : 's'} waiting.`
      : 'The BA agent will ask you next in this workshop. Answer in chat or wait for assigned questions.'
    : `You have ${questionsForYou.length} unanswered question${questionsForYou.length === 1 ? '' : 's'} assigned to you in this workshop.`

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-brand/25 bg-kumo-brand/10 px-5 py-3"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 text-kumo-brand">
          {beingInterviewed ? <UserFocus size={18} weight="duotone" /> : <Question size={18} weight="duotone" />}
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-kumo-default">{title}</p>
          <p className="mt-0.5 text-[12.5px] text-kumo-subtle">{body}</p>
        </div>
      </div>
      {questionsForYou.length > 0 && (
        <button
          type="button"
          onClick={onOpenQuestions}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-kumo-brand px-3 text-[12.5px] font-medium text-white hover:bg-kumo-brand-hover"
        >
          Review questions
          <Pill tone="warning">{questionsForYou.length}</Pill>
        </button>
      )}
    </div>
  )
}
