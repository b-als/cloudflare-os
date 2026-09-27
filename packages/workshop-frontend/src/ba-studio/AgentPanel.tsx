import { useEffect, useRef, useState } from 'react'
import { ArrowClockwise, Check, Flag, Lightbulb, PaperPlaneRight, Question, Robot, X } from '@phosphor-icons/react'
import { AGENT_SCRIPTS, type AgentTurn } from './agentScripts'
import type { StageId } from './prototype'
import { STAGES } from './stages'
import { DemoDataBadge, Pill } from './ui'

type Decision = 'confirmed' | 'rejected'

const REVEAL_DELAY_MS = 700

const actionMeta = {
  propose: { label: 'Proposes', icon: Lightbulb, tone: 'brand' as const, confirm: 'Accept', confirmed: 'Accepted', reject: 'Reject' },
  ask: { label: 'Asks', icon: Question, tone: 'info' as const, confirm: 'Answered', confirmed: 'Answered', reject: 'Skip' },
  flag: { label: 'Flags', icon: Flag, tone: 'warning' as const, confirm: 'Acknowledge', confirmed: 'Acknowledged', reject: 'Dismiss' },
}

function ActionCard({
  turn,
  decision,
  onDecide,
}: {
  turn: Extract<AgentTurn, { kind: 'propose' | 'ask' | 'flag' }>
  decision: Decision | undefined
  onDecide: (decision: Decision) => void
}) {
  const meta = actionMeta[turn.kind]
  const Icon = meta.icon
  return (
    <div className="rounded-lg border border-kumo-line bg-kumo-base p-2.5">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <Pill tone={meta.tone}>
          <Icon size={11} weight="bold" />
          {meta.label}
        </Pill>
        {turn.method && <span className="text-[10.5px] text-kumo-inactive">{turn.method}</span>}
      </div>
      <p className="text-[12.5px] font-medium leading-[17px] text-kumo-default">{turn.title}</p>
      <p className="mt-0.5 text-[12px] leading-[17px] text-kumo-subtle">{turn.detail}</p>
      <div className="mt-2 flex items-center gap-1.5">
        {decision ? (
          <Pill tone={decision === 'confirmed' ? 'success' : 'neutral'}>
            {decision === 'confirmed' ? <Check size={11} weight="bold" /> : <X size={11} weight="bold" />}
            {decision === 'confirmed' ? `${meta.confirmed} by you` : 'Declined'}
          </Pill>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onDecide('confirmed')}
              className="inline-flex h-6 items-center gap-1 rounded-md bg-kumo-brand px-2 text-[11.5px] font-medium text-white hover:bg-kumo-brand-hover"
            >
              <Check size={11} weight="bold" />
              {meta.confirm}
            </button>
            <button
              type="button"
              onClick={() => onDecide('rejected')}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-kumo-line px-2 text-[11.5px] text-kumo-default hover:bg-kumo-tint"
            >
              {meta.reject}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The always-open BA agent panel. In the prototype it plays a scripted conversation for the
 * current stage, showing what the agent proposes, asks and flags and what the human confirms.
 */
export default function AgentPanel({ stage }: { stage: StageId }) {
  const script = AGENT_SCRIPTS[stage]
  const stageDef = STAGES.find((s) => s.id === stage)
  const [revealed, setRevealed] = useState(1)
  const [decisions, setDecisions] = useState<Record<number, Decision>>({})
  const [extraTurns, setExtraTurns] = useState<AgentTurn[]>([])
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (revealed >= script.length) return
    const timer = window.setTimeout(() => setRevealed((count) => count + 1), REVEAL_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [revealed, script.length])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [revealed, extraTurns.length])

  const turns = [...script.slice(0, revealed), ...extraTurns]
  const typing = revealed < script.length

  const send = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    setExtraTurns((current) => [
      ...current,
      { kind: 'message', from: 'user', text },
      {
        kind: 'message',
        from: 'agent',
        text: 'Noted. In the live version I would fold this into the project artifacts and tell you exactly what changed. This preview replays a scripted conversation.',
      },
    ])
  }

  const replay = () => {
    setRevealed(1)
    setDecisions({})
    setExtraTurns([])
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-kumo-line bg-kumo-elevated">
      <header className="flex items-center justify-between gap-2 border-b border-kumo-line px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-kumo-brand/15 text-kumo-brand">
            <Robot size={16} weight="duotone" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-kumo-default">BA agent</p>
            <p className="truncate text-[11px] text-kumo-subtle">{stageDef?.method}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <DemoDataBadge label="Scripted" />
          <button
            type="button"
            onClick={replay}
            title="Replay conversation"
            className="flex h-6 w-6 items-center justify-center rounded-md text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
          >
            <ArrowClockwise size={13} />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {turns.map((turn, index) =>
          turn.kind === 'message' ? (
            <div key={index} className={`flex ${turn.from === 'user' ? 'justify-end' : 'justify-start'}`}>
              <p
                className={`max-w-[88%] rounded-xl px-3 py-2 text-[12.5px] leading-[18px] ${
                  turn.from === 'user' ? 'bg-kumo-brand text-white' : 'bg-kumo-base text-kumo-default'
                }`}
              >
                {turn.text}
              </p>
            </div>
          ) : (
            <ActionCard
              key={index}
              turn={turn}
              decision={decisions[index]}
              onDecide={(decision) => setDecisions((current) => ({ ...current, [index]: decision }))}
            />
          ),
        )}
        {typing && <p className="px-1 text-[11.5px] italic text-kumo-inactive">BA agent is thinking…</p>}
      </div>

      <form
        className="flex items-center gap-2 border-t border-kumo-line p-2.5"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Reply to the BA agent…"
          className="h-8 min-w-0 flex-1 rounded-lg border border-kumo-line bg-kumo-base px-2.5 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-kumo-brand text-white disabled:opacity-50"
          title="Send"
        >
          <PaperPlaneRight size={14} weight="fill" />
        </button>
      </form>
    </aside>
  )
}
