import { useEffect, useState } from 'react'
import { LockSimple, X } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { AiChatAuthorInfo, AuthenticatedApi } from '@gadgets/workshop-shared/api'
import type { DurationUnit, ProcessNode, StepDuration } from '@gadgets/gatekeeper-process/types'
import PersonField from './PersonField'
import { Pill } from './ui'

/** Editable step-detail fields, matching `updateNode`'s optional fields (`null` clears). */
export type StepDetailPatch = {
  description?: string | null
  owner?: string | null
  system?: string | null
  inputs?: string[] | null
  outputs?: string[] | null
  duration?: StepDuration | null
  painPoints?: string | null
}

const DURATION_UNITS: DurationUnit[] = ['minutes', 'hours', 'days']

function linesToList(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}

function TextField({
  label,
  value,
  onCommit,
  disabled,
  multiline,
  placeholder,
}: {
  label: string
  value: string
  onCommit: (value: string) => void
  disabled: boolean
  multiline?: boolean
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  const className =
    'w-full rounded-lg border border-kumo-line bg-kumo-base px-2.5 py-1.5 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand disabled:opacity-60'
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-kumo-inactive">{label}</span>
      {multiline ? (
        <textarea
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          rows={3}
          className={`${className} resize-none`}
        />
      ) : (
        <input
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
          className={className}
        />
      )}
    </label>
  )
}

export type StepDetailsPanelProps = {
  node: ProcessNode
  readOnly: boolean
  locked: boolean
  /** The workspace's collaborators, suggested when filling in the owner field. */
  people: AiChatAuthorInfo[]
  authenticatedApi: RpcStub<AuthenticatedApi>
  onPatch: (patch: StepDetailPatch) => void
  onLock: (input: { summary: string; rationale: string }) => void
  onClose: () => void
}

/** Side panel for one step's descriptive fields: what it does, who owns it, and its cost. */
export default function StepDetailsPanel(
  { node, readOnly, locked, people, authenticatedApi, onPatch, onLock, onClose }: StepDetailsPanelProps,
) {
  const disabled = readOnly || locked
  const [lockOpen, setLockOpen] = useState(false)
  const [lockSummary, setLockSummary] = useState('')
  const [lockRationale, setLockRationale] = useState('')

  const submitLock = () => {
    if (!lockSummary.trim()) return
    onLock({ summary: lockSummary.trim(), rationale: lockRationale.trim() })
    setLockOpen(false)
    setLockSummary('')
    setLockRationale('')
  }

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col overflow-y-auto border-l border-kumo-line bg-kumo-elevated">
      <header className="flex items-center justify-between gap-2 border-b border-kumo-line px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-kumo-default">{node.label}</p>
          {locked && (
            <Pill tone="warning">
              <LockSimple size={10} weight="fill" />
              Locked
            </Pill>
          )}
        </div>
        <button type="button" onClick={onClose} title="Close" className="rounded-md p-1 text-kumo-subtle hover:bg-kumo-tint">
          <X size={14} />
        </button>
      </header>

      <div className="flex flex-col gap-3 p-3">
        <TextField
          label="Description"
          value={node.description ?? ''}
          onCommit={(value) => onPatch({ description: value.trim() === '' ? null : value })}
          disabled={disabled}
          multiline
          placeholder="What happens in this step"
        />
        <PersonField
          label="Owner"
          value={node.owner ?? ''}
          people={people}
          authenticatedApi={authenticatedApi}
          onCommit={(value) => onPatch({ owner: value.trim() === '' ? null : value })}
          disabled={disabled}
          placeholder="Role, team, or person responsible"
        />
        <TextField
          label="System"
          value={node.system ?? ''}
          onCommit={(value) => onPatch({ system: value.trim() === '' ? null : value })}
          disabled={disabled}
          placeholder="Tool or system used"
        />
        <TextField
          label="Inputs"
          value={(node.inputs ?? []).join('\n')}
          onCommit={(value) => {
            const list = linesToList(value)
            onPatch({ inputs: list.length === 0 ? null : list })
          }}
          disabled={disabled}
          multiline
          placeholder="One per line"
        />
        <TextField
          label="Outputs"
          value={(node.outputs ?? []).join('\n')}
          onCommit={(value) => {
            const list = linesToList(value)
            onPatch({ outputs: list.length === 0 ? null : list })
          }}
          disabled={disabled}
          multiline
          placeholder="One per line"
        />
        <div>
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-kumo-inactive">Duration</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              step="any"
              disabled={disabled}
              defaultValue={node.duration?.amount ?? ''}
              onBlur={(event) => {
                const amount = event.currentTarget.valueAsNumber
                if (!Number.isFinite(amount) || amount <= 0) {
                  if (node.duration) onPatch({ duration: null })
                  return
                }
                onPatch({ duration: { amount, unit: node.duration?.unit ?? 'hours' } })
              }}
              className="h-8 w-20 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand disabled:opacity-60"
            />
            <select
              disabled={disabled}
              value={node.duration?.unit ?? 'hours'}
              onChange={(event) => {
                if (!node.duration) return
                onPatch({ duration: { amount: node.duration.amount, unit: event.target.value as DurationUnit } })
              }}
              className="h-8 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[12.5px] text-kumo-default disabled:opacity-60"
            >
              {DURATION_UNITS.map((unit) => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </select>
          </div>
        </div>
        <TextField
          label="Pain points"
          value={node.painPoints ?? ''}
          onCommit={(value) => onPatch({ painPoints: value.trim() === '' ? null : value })}
          disabled={disabled}
          multiline
          placeholder="Known issues or friction"
        />

        {!readOnly && !locked && (
          <div className="border-t border-kumo-line pt-3">
            {lockOpen ? (
              <div className="flex flex-col gap-2">
                <input
                  autoFocus
                  value={lockSummary}
                  onChange={(event) => setLockSummary(event.target.value)}
                  placeholder="What was decided"
                  className="h-8 rounded-lg border border-kumo-line bg-kumo-base px-2.5 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand"
                />
                <textarea
                  value={lockRationale}
                  onChange={(event) => setLockRationale(event.target.value)}
                  placeholder="Why (optional)"
                  rows={2}
                  className="resize-none rounded-lg border border-kumo-line bg-kumo-base px-2.5 py-1.5 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={submitLock}
                    disabled={!lockSummary.trim()}
                    className="h-8 flex-1 rounded-lg bg-kumo-brand text-[12.5px] font-medium text-white hover:bg-kumo-brand-hover disabled:opacity-60"
                  >
                    Lock step
                  </button>
                  <button
                    type="button"
                    onClick={() => setLockOpen(false)}
                    className="h-8 rounded-lg border border-kumo-line px-2.5 text-[12.5px] text-kumo-default hover:bg-kumo-tint"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLockOpen(true)}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-kumo-line text-[12.5px] text-kumo-default hover:bg-kumo-tint"
              >
                <LockSimple size={13} />
                Lock this step
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
