import { useEffect, useRef, type ReactNode } from 'react'
import { Badge, Button, Textarea } from '@cloudflare/kumo'
import { ArrowUp, Check, MapPin, Sparkle, WarningCircle } from '@phosphor-icons/react'

type SampleConversationProps = {
  draft: string
  notes: string[]
  decision: 'pending' | 'accepted' | 'declined'
  steps: { id: string; label: string }[]
  focusedStepId: string | null
  onDraftChange: (draft: string) => void
  onAddNote: () => void
  onDecide: (decision: 'accepted' | 'declined') => void
  onFocusStep: (stepId: string) => void
  onOpenRecord: (recordId: string) => void
}

type LinkedCardProps = {
  stepIds: string[]
  recordId: string
  recordLabel: string
  className: string
  children: ReactNode
} & Pick<SampleConversationProps, 'steps' | 'focusedStepId' | 'onFocusStep' | 'onOpenRecord'>

/** An analyst card tied to map steps and a context record, highlighted while one of its steps is in focus. */
const LinkedCard = ({ stepIds, recordId, recordLabel, className, children, steps, focusedStepId, onFocusStep, onOpenRecord }: LinkedCardProps) => {
  const linked = !!focusedStepId && stepIds.includes(focusedStepId)
  return (
    <div data-step-ids={stepIds.join(' ')} className={`rounded-xl border p-4 transition-colors ${linked ? 'border-kumo-brand ring-1 ring-kumo-brand' : className}`}>
      {linked && <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-kumo-brand">About the focused step</p>}
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-kumo-line pt-3">
        {stepIds.map((id) => {
          const label = steps.find((step) => step.id === id)?.label
          return label && (
            <Button key={id} size="xs" variant={id === focusedStepId ? 'primary' : 'secondary'} aria-label={`Show ${label} on map`} onClick={() => onFocusStep(id)}>
              <MapPin size={11} aria-hidden />{label}
            </Button>
          )
        })}
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => onOpenRecord(recordId)}>{recordLabel}</Button>
      </div>
    </div>
  )
}

export const SampleConversation = ({ draft, notes, decision, steps, focusedStepId, onDraftChange, onAddNote, onDecide, onFocusStep, onOpenRecord }: SampleConversationProps) => {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const history = useRef<HTMLDivElement>(null)
  const links = { steps, focusedStepId, onFocusStep, onOpenRecord }
  const focusedLabel = steps.find((step) => step.id === focusedStepId)?.label

  useEffect(() => {
    if (notes.length && history.current) history.current.scrollTop = history.current.scrollHeight
  }, [notes.length])

  // Bring the part of the conversation about the focused step into view, wherever the focus came from.
  useEffect(() => {
    if (focusedStepId) history.current?.querySelector(`[data-step-ids~="${focusedStepId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedStepId])

  return (
    <section aria-label="Sample conversation" className="flex h-[650px] min-h-0 flex-col border-b border-kumo-line bg-kumo-base lg:h-full lg:w-[380px] lg:shrink-0 lg:border-b-0 lg:border-r xl:w-[400px]">
      <div className="flex items-center gap-3 border-b border-kumo-line px-5 py-4">
        <span className="flex size-9 items-center justify-center rounded-xl border border-kumo-line bg-kumo-tint text-kumo-brand"><Sparkle size={19} aria-hidden /></span>
        <div><h2 className="text-sm font-semibold text-kumo-default">Your process analyst</h2><p className="mt-0.5 text-xs text-kumo-subtle">Sample conversation · no model connected</p></div>
      </div>
      <div ref={history} className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 text-[13px] leading-[1.65]">
        <div className="ml-7 rounded-2xl rounded-tr-sm bg-kumo-tint px-4 py-3 text-kumo-default">
          Suppliers keep chasing payment. I want to understand where invoices get stuck, without losing our financial controls.
        </div>
        <div className="text-kumo-default">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle"><Sparkle size={12} aria-hidden />Analyst · sample</p>
          <p>I’ve mapped the usual path. The important gap is what happens when an approver is away—not another step in the happy path.</p>
        </div>
        <LinkedCard {...links} stepIds={['approve']} recordId="approval-evidence" recordLabel="See both accounts" className="border-kumo-line bg-kumo-elevated">
          <p className="flex items-center gap-2 text-xs font-semibold text-kumo-default"><WarningCircle size={16} className="text-kumo-warning" aria-hidden />Two perspectives to reconcile</p>
          <p className="mt-2 text-kumo-default">Finance reports two days. Operations has seen nine. These may be different scenarios; neither account is verified yet.</p>
        </LinkedCard>
        <div className="text-kumo-default">
          <p>My recommendation is to preserve the independent payment check while we clarify cover arrangements.</p>
        </div>
        <LinkedCard {...links} stepIds={['approve', 'pay']} recordId="control" recordLabel="Options and trade-offs" className="border-kumo-brand/30 bg-kumo-base">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">Proposed decision</p>
            <Badge variant="outline">Sample</Badge>
          </div>
          <h3 className="mt-2 text-sm font-semibold leading-5 text-kumo-default">Keep approval separate from payment</h3>
          <p className="mt-2 text-xs leading-5 text-kumo-subtle">Preserves an independent check. A named backup approver is still needed.</p>
          {decision === 'pending' ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => onDecide('accepted')}><Check size={13} aria-hidden />Accept sample</Button>
              <Button size="sm" variant="secondary" onClick={() => {
                onDraftChange('About the proposed control: I would change ')
                textarea.current?.focus()
              }}>Suggest a change</Button>
              <Button size="sm" variant="ghost" onClick={() => onDecide('declined')}>Decline</Button>
            </div>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-kumo-default">
              <Check size={13} aria-hidden />{decision === 'accepted' ? 'Accepted locally. The map and context updated.' : 'Declined locally. No sample decision recorded.'}
            </p>
          )}
        </LinkedCard>
        {notes.map((note, index) => (
          <div key={index} className="ml-7 rounded-2xl rounded-tr-sm bg-kumo-tint px-4 py-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-kumo-subtle">Your local design note</p>
            <p className="whitespace-pre-wrap break-words text-kumo-default">{note}</p>
          </div>
        ))}
      </div>
      <form
        className="border-t border-kumo-line p-4"
        onSubmit={(event) => {
          event.preventDefault()
          onAddNote()
        }}
      >
        {focusedLabel && <p className="mb-2 flex items-center gap-1 text-xs text-kumo-subtle"><MapPin size={12} aria-hidden />Talking about <span className="font-medium text-kumo-default">{focusedLabel}</span></p>}
        <div className="rounded-xl border border-kumo-line bg-kumo-elevated p-2 focus-within:ring-1 focus-within:ring-kumo-brand">
          <Textarea
            ref={textarea}
            aria-label="Local design note"
            placeholder={focusedLabel ? `Ask about ${focusedLabel}…` : 'Try the composer. This adds a local note only.'}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            maxLength={2000}
            rows={2}
            className="w-full resize-none border-0 bg-transparent text-[13px] shadow-none"
          />
          <div className="flex items-center justify-between gap-3 px-1 pb-1">
            <span className="text-[10px] text-kumo-subtle">No AI response. Nothing sent.</span>
            <Button type="submit" shape="circle" size="sm" variant="primary" aria-label="Add local design note" disabled={!draft.trim()}><ArrowUp size={15} aria-hidden /></Button>
          </div>
        </div>
      </form>
    </section>
  )
}
