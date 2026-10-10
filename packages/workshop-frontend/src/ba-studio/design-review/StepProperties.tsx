import { useRef, useState } from 'react'
import { Badge, Button, Dialog, Input, Select, Textarea } from '@cloudflare/kumo'
import { Check, SlidersHorizontal, WarningCircle, X } from '@phosphor-icons/react'
import type { DurationUnit, ProcessLane, ProcessNodeType } from '@gadgets/gatekeeper-process/types'
import type { BriefEntry, SampleStep } from './sampleData'
import { useCompactLayout } from './useCompactLayout'

export type StepPropertyValues = {
  label: string
  assignedPersonId: string
  laneId: string
  owner: string
  system: string
  description: string
  durationAmount: string
  durationUnit: DurationUnit
  painPoints: string
}

export const readStepProperties = (step: SampleStep): StepPropertyValues => ({
  label: step.label,
  assignedPersonId: step.assignedPersonId ?? '',
  laneId: step.laneId,
  owner: step.owner ?? '',
  system: step.system ?? '',
  description: step.description ?? '',
  durationAmount: step.duration ? String(step.duration.amount) : '',
  durationUnit: step.duration?.unit ?? 'days',
  painPoints: step.painPoints ?? '',
})

export const STEP_KIND: Record<ProcessNodeType, string> = {
  startEvent: 'Start', endEvent: 'End', timerEvent: 'Timer', userTask: 'Human task',
  serviceTask: 'System task', manualTask: 'Manual task',
  exclusiveGateway: 'Decision', parallelGateway: 'Parallel paths',
}

type StepPropertiesProps = {
  step: SampleStep
  values: StepPropertyValues
  lanes: ProcessLane[]
  people: BriefEntry[]
  dirty: boolean
  leaving: boolean
  onChange: (values: StepPropertyValues) => void
  onSave: (step: SampleStep) => void
  onCancel: () => void
  onRequestClose: () => void
  onDiscard: () => void
  onKeepEditing: () => void
}

export const StepProperties = ({ step, values, lanes, people, dirty, leaving, onChange, onSave, onCancel, onRequestClose, onDiscard, onKeepEditing }: StepPropertiesProps) => {
  const compact = useCompactLayout()
  const [selectPortalContainer, setSelectPortalContainer] = useState<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const durationInput = useRef<HTMLInputElement>(null)
  const change = <K extends keyof StepPropertyValues>(field: K, value: StepPropertyValues[K]) => {
    onChange({ ...values, [field]: value })
    setError(null)
  }

  const content = (
    <>
      <div className="shrink-0 border-b border-kumo-line px-5 py-4">
        <div className="flex items-center gap-3">
          <SlidersHorizontal size={17} aria-hidden className="text-kumo-subtle" />
          {compact ? <Dialog.Title className="min-w-0 flex-1 text-sm font-semibold">Step properties</Dialog.Title>
            : <h2 className="min-w-0 flex-1 text-sm font-semibold">Step properties</h2>}
          <Button size="sm" variant="ghost" shape="square" aria-label="Close properties" onClick={onRequestClose}><X size={16} aria-hidden /></Button>
        </div>
        <p className="mt-3 truncate text-sm font-medium">{step.label}</p>
        <div className="mt-2 flex items-center gap-2">
          <Badge variant="outline">{STEP_KIND[step.type]}</Badge>
          <span className="text-[11px] text-kumo-subtle">{dirty ? 'Unsaved changes' : 'Sample block'}</span>
        </div>
      </div>
      <form
        aria-label="Edit sample step"
        className="flex min-h-0 flex-1 flex-col"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (!values.label.trim()) {
            setError('Enter a step name.')
            nameInput.current?.focus()
            return
          }
          const amount = values.durationAmount.trim() ? Number(values.durationAmount) : undefined
          if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
            setError('Duration must be a number greater than zero, or left blank.')
            durationInput.current?.focus()
            return
          }
          onSave({
            ...step, label: values.label.trim(), laneId: values.laneId,
            assignedPersonId: values.assignedPersonId || undefined,
            owner: values.owner.trim() || undefined, system: values.system.trim() || undefined,
            description: values.description.trim() || undefined, painPoints: values.painPoints.trim() || undefined,
            duration: amount === undefined ? undefined : { amount, unit: values.durationUnit },
          })
        }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {leaving && (
            <div role="alert" className="mb-4 rounded-lg border border-kumo-line bg-kumo-tint p-3">
              <p className="flex items-center gap-2 text-[13px] font-medium"><WarningCircle size={16} className="text-kumo-warning" aria-hidden />You have unsaved sample changes</p>
              <p className="mt-1 text-xs text-kumo-subtle">Save first, or discard this draft before leaving.</p>
              <div className="mt-3 flex gap-2">
                <Button type="button" size="sm" variant="secondary-destructive" onClick={onDiscard}>Discard changes</Button>
                <Button type="button" size="sm" variant="secondary" autoFocus onClick={() => {
                  onKeepEditing()
                  nameInput.current?.focus()
                }}>Keep editing</Button>
              </div>
            </div>
          )}
          <div className="grid gap-4">
            <div>
              <Input ref={nameInput} label="Step name" value={values.label} onChange={(event) => change('label', event.target.value)} autoFocus maxLength={160} required className="w-full" />
            </div>
            <Select<string>
              label="Assigned person" value={values.assignedPersonId}
              items={[{ value: '', label: 'Unassigned' }, ...people.map((person) => ({ value: person.id, label: person.title }))]}
              onValueChange={(value) => change('assignedPersonId', value ?? '')}
              container={compact ? selectPortalContainer : undefined}
              className="w-full"
            >
              <Select.Option value="">Unassigned</Select.Option>
              {people.map((person) => <Select.Option key={person.id} value={person.id}>{person.title}</Select.Option>)}
            </Select>
            <Select<string>
              label="Team" value={values.laneId} items={lanes.map((lane) => ({ value: lane.id, label: lane.label }))}
              onValueChange={(value) => { if (value) change('laneId', value) }}
              container={compact ? selectPortalContainer : undefined}
              className="w-full"
            >
              {lanes.map((lane) => <Select.Option key={lane.id} value={lane.id}>{lane.label}</Select.Option>)}
            </Select>
            <Input label="Responsible role" value={values.owner} onChange={(event) => change('owner', event.target.value)} maxLength={100} placeholder="Not assigned" className="w-full" />
            <Input label="System or tool" value={values.system} onChange={(event) => change('system', event.target.value)} maxLength={100} placeholder="None recorded" className="w-full" />
            <div>
              <Textarea label="Description" value={values.description} onChange={(event) => change('description', event.target.value)} rows={2} maxLength={2000} className="w-full resize-y" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input ref={durationInput} label="Duration" type="number" min={0} step="any" value={values.durationAmount} onChange={(event) => change('durationAmount', event.target.value)} placeholder="Not established" className="w-full" />
              <Select<DurationUnit>
                label="Duration unit" value={values.durationUnit} items={{ minutes: 'Minutes', hours: 'Hours', days: 'Days' }}
                onValueChange={(value) => { if (value) change('durationUnit', value) }}
                container={compact ? selectPortalContainer : undefined}
                className="w-full"
              >
                <Select.Option value="minutes">Minutes</Select.Option>
                <Select.Option value="hours">Hours</Select.Option>
                <Select.Option value="days">Days</Select.Option>
              </Select>
            </div>
            <div>
              <Textarea label="Friction or exceptions" value={values.painPoints} onChange={(event) => change('painPoints', event.target.value)} rows={2} maxLength={2000} className="w-full resize-y" />
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t border-kumo-line bg-kumo-elevated px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error && <p role="alert" className="mb-2 text-xs text-kumo-danger">{error}</p>}
          <p className="mb-3 text-[11px] text-kumo-subtle">{dirty ? 'Unsaved sample changes' : 'Sample data only. Nothing saved to a project.'}</p>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button type="submit" variant="primary"><Check size={14} aria-hidden />Save sample</Button>
          </div>
        </div>
      </form>
      {/* Keep dropdown portals inside the mobile modal's focus and accessibility boundary. */}
      <div ref={setSelectPortalContainer} className="absolute left-0 top-0 z-[1100]" />
    </>
  )

  if (compact) return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onRequestClose() }}>
      <Dialog className="!fixed !inset-y-0 !left-auto !right-0 !flex h-dvh !w-[min(384px,100vw)] !max-w-none !translate-x-0 !rounded-none flex-col bg-kumo-base p-0">
        <Dialog.Description className="sr-only">Edit the selected sample block. Changes apply only after Save.</Dialog.Description>
        {content}
      </Dialog>
    </Dialog.Root>
  )

  return (
    <aside
      aria-label="Step properties"
      className="flex h-full min-h-0 w-[360px] shrink-0 flex-col border-l border-kumo-line bg-kumo-base xl:w-96"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.stopPropagation()
          onRequestClose()
        }
      }}
    >{content}</aside>
  )
}
