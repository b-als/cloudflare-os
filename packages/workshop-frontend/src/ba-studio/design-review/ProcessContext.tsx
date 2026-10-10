import { useState, type RefObject } from 'react'
import { Button, Collapsible } from '@cloudflare/kumo'
import { ArrowLeft, CaretDown, DownloadSimple, SlidersHorizontal, WarningCircle } from '@phosphor-icons/react'
import { CountBadge } from '../../components/CountBadge'
import { BriefRecord } from './BriefRecord'
import { STEP_KIND } from './StepProperties'
import { SAMPLE_REVIEW_TOPICS, inStepScope, isOpenItem, type BriefEntry, type SampleGraph, type SampleStep } from './sampleData'

type ProcessContextProps = {
  entries: BriefEntry[]
  graph: SampleGraph
  step: SampleStep | null
  openRecordId: string | null
  editButtonRef: RefObject<HTMLButtonElement | null>
  onOpenRecordChange: (id: string | null) => void
  onEditStep: () => void
  onClearStep: () => void
  onFocusStep: (stepId: string) => void
  onDiscuss: (entry: BriefEntry) => void
  onAssignOwner: (name: string) => void
  onDownload: () => void
}

const SectionHeading = ({ title, count }: { title: string; count: number }) => (
  <h3 className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-kumo-subtle">
    {title}<CountBadge count={count} max={99} />
  </h3>
)

/** Whatever is in focus — the whole process or one step — with the knowledge that hangs off it. */
export const ProcessContext = ({
  entries, graph, step, openRecordId, editButtonRef,
  onOpenRecordChange, onEditStep, onClearStep, onFocusStep, onDiscuss, onAssignOwner, onDownload,
}: ProcessContextProps) => {
  const [settledOpen, setSettledOpen] = useState(false)
  const scoped = entries.filter((entry) => inStepScope(entry, step?.id ?? null))
  const purpose = entries.find((entry) => entry.section === 'Purpose')
  const people = scoped.filter((entry) => entry.section === 'People')
  const settled = scoped.filter((entry) => entry.section === 'Decisions' && entry.status === 'Agreed')
  const settledExpanded = settledOpen || settled.some((entry) => entry.id === openRecordId)
  const topics = SAMPLE_REVIEW_TOPICS.map((topic) => ({
    ...topic,
    records: topic.recordIds.flatMap((id) => scoped.filter((entry) => entry.id === id && entry.status !== 'Agreed')),
  })).filter((topic) => topic.records.length)
  const openCount = scoped.filter(isOpenItem).length
  const assignee = step && entries.find((entry) => entry.id === step.assignedPersonId)?.title

  const renderRecord = (entry: BriefEntry) => (
    <div key={entry.id} data-record-id={entry.id}>
      <BriefRecord
        entry={entry} evidence={entries.find((item) => item.id === entry.evidenceId)}
        steps={graph.nodes.filter((node) => node.id !== step?.id && entry.nodeIds.includes(node.id))}
        open={openRecordId === entry.id}
        onOpenChange={(open) => onOpenRecordChange(open ? entry.id : null)}
        onFocusStep={onFocusStep} onDiscuss={onDiscuss} onAssignOwner={onAssignOwner}
      />
    </div>
  )

  return (
    <section aria-label="Process context" className="flex h-full min-h-0 flex-col bg-kumo-base">
      <header className="shrink-0 border-b border-kumo-line px-5 py-4">
        {step ? (
          <>
            <Button size="xs" variant="ghost" onClick={onClearStep} className="-ml-2 text-kumo-subtle">
              <ArrowLeft size={12} aria-hidden />Whole process
            </Button>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-kumo-subtle">
              {STEP_KIND[step.type]} · {graph.lanes.find((lane) => lane.id === step.laneId)?.label}
            </p>
            <div className="mt-1 flex items-start gap-3">
              <h2 className="min-w-0 flex-1 text-base font-semibold leading-6">{step.label}</h2>
              <Button ref={editButtonRef} size="sm" variant="secondary" onClick={onEditStep}>
                <SlidersHorizontal size={13} aria-hidden />Edit
              </Button>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {[
                ['Person', assignee ?? 'Unassigned'],
                ['Role', step.owner ?? 'Not recorded'],
                ['System', step.system ?? 'None recorded'],
                ['Duration', step.duration ? `${step.duration.amount} ${step.duration.unit}` : 'Not established'],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-kumo-subtle">{label}</dt>
                  <dd className="truncate font-medium text-kumo-default">{value}</dd>
                </div>
              ))}
            </dl>
            {step.painPoints && (
              <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-kumo-default">
                <WarningCircle size={14} className="mt-0.5 shrink-0 text-kumo-warning" aria-hidden />{step.painPoints}
              </p>
            )}
          </>
        ) : (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-kumo-subtle">Whole process · goal</p>
              <h2 className="mt-1 text-base font-semibold leading-6">{purpose?.title}</h2>
              <p className="mt-1 text-xs leading-5 text-kumo-subtle">{purpose?.summary}</p>
            </div>
            <Button size="sm" variant="ghost" shape="square" aria-label="Download sample" onClick={onDownload}>
              <DownloadSimple size={15} aria-hidden />
            </Button>
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-4">
        <section aria-label="Open items">
          <SectionHeading title={step ? 'Open on this step' : 'Open'} count={openCount} />
          {topics.length ? topics.map((topic) => (
            <div key={topic.id} className="mt-3">
              <p className="text-[13px] font-semibold text-kumo-default">{topic.title}</p>
              <p className="text-xs leading-5 text-kumo-subtle">{topic.summary}</p>
              <div className="mt-1">{topic.records.map(renderRecord)}</div>
            </div>
          )) : <p className="py-2 text-xs text-kumo-subtle">Nothing open {step ? 'on this step' : 'in this process'}. This is not a sign-off.</p>}
        </section>
        <section aria-label="People">
          <SectionHeading title={step ? 'People on this step' : 'People'} count={people.length} />
          {people.length ? people.map(renderRecord) : <p className="py-2 text-xs text-kumo-subtle">Nobody linked to this step yet.</p>}
        </section>
        {settled.length > 0 && (
          <Collapsible.Root
            open={settledExpanded}
            onOpenChange={(open) => {
              setSettledOpen(open)
              if (!open && settled.some((entry) => entry.id === openRecordId)) onOpenRecordChange(null)
            }}
            className="border-t border-kumo-line pt-3"
          >
            <Collapsible.Trigger className="flex w-full items-center gap-2 rounded py-1 text-[11px] font-semibold uppercase tracking-wider text-kumo-subtle outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand">
              Settled ({settled.length})<CaretDown size={12} aria-hidden className={settledExpanded ? 'rotate-180' : ''} />
            </Collapsible.Trigger>
            <Collapsible.Panel>{settled.map(renderRecord)}</Collapsible.Panel>
          </Collapsible.Root>
        )}
      </div>
    </section>
  )
}
