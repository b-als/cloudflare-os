import { useState } from 'react'
import { Button, Collapsible, Input } from '@cloudflare/kumo'
import { ArrowUpRight, CaretDown, Check, LinkSimple, MapPin, PencilSimple } from '@phosphor-icons/react'
import type { BriefEntry } from './sampleData'

type BriefRecordProps = {
  entry: BriefEntry
  open: boolean
  onOpenChange: (open: boolean) => void
  onDiscuss: (entry: BriefEntry) => void
  evidence?: BriefEntry
  /** Map steps the record concerns, other than the one already in focus. */
  steps: { id: string; label: string }[]
  onFocusStep: (stepId: string) => void
  onAssignOwner: (name: string) => void
}

export const BriefRecord = ({ entry, evidence, steps, open, onOpenChange, onDiscuss, onFocusStep, onAssignOwner }: BriefRecordProps) => {
  const [editingOwner, setEditingOwner] = useState(false)
  const [owner, setOwner] = useState('')

  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange} className="border-b border-kumo-line last:border-0">
      <Collapsible.Trigger className="flex w-full items-center gap-3 rounded-md py-2.5 text-left outline-none hover:bg-kumo-tint focus-visible:ring-2 focus-visible:ring-kumo-brand">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium leading-5 text-kumo-default">{entry.title}</span>
          <span className="mt-0.5 block text-xs leading-5 text-kumo-subtle">
            {entry.status !== 'Agreed' && entry.status !== 'Open' && (
              <span className={entry.status === 'Disputed' ? 'font-medium text-kumo-warning' : 'font-medium'}>{entry.status} · </span>
            )}
            {entry.summary}
          </span>
        </span>
        <CaretDown size={14} aria-hidden className={`shrink-0 text-kumo-subtle ${open ? 'rotate-180' : ''}`} />
      </Collapsible.Trigger>
      <Collapsible.Panel>
        <div className="mb-3 rounded-lg border border-kumo-line bg-kumo-elevated p-4">
          <dl className="space-y-3">
            {entry.details.map((detail) => (
              <div key={detail.label}>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">{detail.label}</dt>
                <dd className="mt-1 text-[13px] leading-5 text-kumo-default">{detail.value}</dd>
              </div>
            ))}
          </dl>
          {steps.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">On the map</span>
              {steps.map((step) => (
                <Button key={step.id} size="xs" variant="secondary" aria-label={`Show ${step.label} on map`} onClick={() => onFocusStep(step.id)}>
                  <MapPin size={11} aria-hidden />{step.label}
                </Button>
              ))}
            </div>
          )}
          <div className="mt-4 border-t border-kumo-line pt-3 text-xs leading-5 text-kumo-subtle">
            <p className="flex items-start gap-1.5"><LinkSimple size={13} className="mt-1 shrink-0" aria-hidden />{entry.source}</p>
            {evidence && (
              <Collapsible.Root className="mt-3 border-t border-kumo-line pt-3">
                <Collapsible.Trigger className="flex w-full items-center justify-between gap-2 rounded text-left text-xs font-medium text-kumo-default outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand">
                  <span className="flex items-center gap-1.5"><LinkSimple size={13} aria-hidden />Supporting evidence</span>
                  <CaretDown size={14} aria-hidden />
                </Collapsible.Trigger>
                <Collapsible.Panel>
                  <div className="mt-3" aria-label={`Supporting evidence: ${evidence.title}`}>
                    <p className="text-[13px] font-medium text-kumo-default">{evidence.title}</p>
                    <p className="mt-1">{evidence.status} · {evidence.summary}</p>
                    <dl className="mt-3 space-y-3">
                      {evidence.details.map((detail) => (
                        <div key={detail.label}>
                          <dt className="font-medium text-kumo-default">{detail.label}</dt>
                          <dd className="mt-1">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-3">{evidence.source}</p>
                  </div>
                </Collapsible.Panel>
              </Collapsible.Root>
            )}
          </div>
          {editingOwner ? (
            <form
              className="mt-3 space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                if (!owner.trim()) return
                onAssignOwner(owner.trim())
                setEditingOwner(false)
              }}
            >
              <Input label="Sample risk owner" value={owner} onChange={(event) => setOwner(event.target.value)} autoFocus required maxLength={80} />
              <div className="flex gap-2">
                <Button size="sm" variant="primary" type="submit"><Check size={12} aria-hidden />Save locally</Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setEditingOwner(false)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => onDiscuss(entry)}>
                Discuss in conversation <ArrowUpRight size={12} aria-hidden />
              </Button>
              {entry.id === 'cover-risk' && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setOwner(entry.details.find((detail) => detail.label === 'Owner')?.value === 'Unassigned'
                    ? '' : entry.details.find((detail) => detail.label === 'Owner')?.value ?? '')
                  setEditingOwner(true)
                }}>
                  <PencilSimple size={12} aria-hidden />Assign sample owner
                </Button>
              )}
            </div>
          )}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
