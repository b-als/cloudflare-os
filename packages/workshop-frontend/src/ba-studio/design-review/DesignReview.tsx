import { useRef, useState } from 'react'
import { Button } from '@cloudflare/kumo'
import { ArrowCounterClockwise, Flask, Sparkle } from '@phosphor-icons/react'
import { LANE_HEIGHT } from '@gadgets/gatekeeper-process/graph-ops'
import { saveTextToFile } from '../../fileTransfers'
import ProcessMap from '../ProcessMap'
import { PhaseIndicator } from '../PhaseIndicator'
import { ProcessContext } from './ProcessContext'
import { SampleConversation } from './SampleConversation'
import { StepProperties, readStepProperties, type StepPropertyValues } from './StepProperties'
import { SAMPLE_ENTRIES, SAMPLE_GRAPH, SAMPLE_PREVIEW, countOpenItems, isOpenItem, type BriefEntry } from './sampleData'
import { useCompactLayout } from './useCompactLayout'

type PropertyEditor = { stepId: string; values: StepPropertyValues; original: StepPropertyValues }
/** Where focus goes once any unsaved property draft is resolved: a step's (or the whole process's) context, or a step's editor. */
type FocusTarget = { kind: 'context'; stepId: string | null } | { kind: 'properties'; stepId: string }

export const DesignReview = () => {
  const compact = useCompactLayout()
  const [graph, setGraph] = useState(SAMPLE_GRAPH)
  const [entries, setEntries] = useState(SAMPLE_ENTRIES)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [openRecordId, setOpenRecordId] = useState<string | null>(null)
  const [editor, setEditor] = useState<PropertyEditor | null>(null)
  const [pending, setPending] = useState<FocusTarget | null>(null)
  const [decision, setDecision] = useState<'pending' | 'accepted' | 'declined'>('pending')
  const [draft, setDraft] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [notice, setNotice] = useState('Explore the sample. No agent calls or project connections.')
  const [reset, setReset] = useState(0)
  const conversation = useRef<HTMLDivElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const selectedStep = graph.nodes.find((step) => step.id === (editor?.stepId ?? selectedStepId)) ?? null
  const editingStep = editor ? graph.nodes.find((step) => step.id === editor.stepId) : undefined
  const dirty = !!editor && JSON.stringify(editor.values) !== JSON.stringify(editor.original)
  const people = entries.filter((entry) => entry.section === 'People')
  const linkedEntries = entries.map((entry) => entry.section === 'People' ? {
    ...entry,
    nodeIds: [...new Set([...entry.nodeIds, ...graph.nodes.filter((step) => step.assignedPersonId === entry.id).map((step) => step.id)])],
  } : entry)
  const displayGraph = {
    ...graph,
    nodes: graph.nodes.map((step) => ({
      ...step,
      owner: people.find((person) => person.id === step.assignedPersonId)?.title ?? step.owner,
    })),
  }

  const goTo = (next: FocusTarget) => {
    setPending(null)
    if (next.kind === 'properties') {
      const step = graph.nodes.find((item) => item.id === next.stepId)
      if (!step) throw new Error('Sample step no longer exists.')
      const values = readStepProperties(step)
      setEditor({ stepId: step.id, values, original: values })
      setSelectedStepId(step.id)
      return
    }
    const closingEditor = editor?.stepId === next.stepId
    setEditor(null)
    setSelectedStepId(next.stepId)
    if (closingEditor) requestAnimationFrame(() => editButton.current?.focus())
  }

  const navigate = (next: FocusTarget) => {
    if (next.kind === 'properties' && editor?.stepId === next.stepId) return
    if (dirty) {
      setPending(next)
      setNotice('The block has unsaved changes. Save, discard, or keep editing.')
    } else goTo(next)
  }

  const focusStep = (stepId: string) => {
    setOpenRecordId(null)
    if (editor) navigate({ kind: 'properties', stepId })
    else setSelectedStepId(stepId)
  }

  const clearStep = () => {
    setOpenRecordId(null)
    if (editor) navigate({ kind: 'context', stepId: null })
    else setSelectedStepId(null)
  }

  const openRecord = (recordId: string) => {
    const record = linkedEntries.find((entry) => entry.id === recordId)
    if (!record) {
      setNotice('That sample record is no longer in the context.')
      return
    }
    const stepId = selectedStep && record.nodeIds.includes(selectedStep.id) ? selectedStep.id : null
    if (editor) navigate({ kind: 'context', stepId })
    else setSelectedStepId(stepId)
    setOpenRecordId(recordId)
    // Focus the record once the context it lives in has rendered.
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLButtonElement>(`[data-record-id="${recordId}"] button`)
      target?.focus()
      target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }

  const decide = (next: 'accepted' | 'declined') => {
    setDecision(next)
    setEntries((current) => next === 'accepted'
      ? current.map((entry) => entry.id === 'control' ? {
        ...entry, status: 'Agreed', summary: 'Accepted locally · independent check retained · backup still unresolved',
      } : entry)
      : current.filter((entry) => entry.id !== 'control'))
    setNotice(next === 'accepted' ? 'Sample decision accepted. The map and context changed locally; your real project did not.' : 'Sample proposal declined. Your real project did not change.')
  }

  const discuss = (entry: BriefEntry) => {
    setDraft(`About "${entry.title}": `)
    conversation.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    conversation.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    setNotice('Record added to the composer. Sending adds a local design note, not an AI request.')
  }

  const download = () => {
    const text = '# SAMPLE ONLY - Supplier invoice approval\n\nUI design fixture, not project data or an actual sign-off.\n\n' +
      graph.nodes.map((step) => `## Step: ${step.label}\n\n` +
        `Assigned person: ${people.find((person) => person.id === step.assignedPersonId)?.title ?? 'Unassigned'}\n\n` +
        `Team: ${graph.lanes.find((lane) => lane.id === step.laneId)?.label}\n\n` +
        `Role: ${step.owner ?? 'Unassigned'}\n\nSystem: ${step.system ?? 'None recorded'}\n\n` +
        `Duration: ${step.duration ? `${step.duration.amount} ${step.duration.unit}` : 'Not established'}\n\n` +
        `Description: ${step.description ?? 'None recorded'}\n\nFriction: ${step.painPoints ?? 'None recorded'}`).join('\n\n') + '\n\n' +
      entries.map((entry) => `## ${entry.section}: ${entry.title}\n\n${entry.status}: ${entry.summary}\n\n` +
        entry.details.map((detail) => `${detail.label}: ${detail.value}`).join('\n\n') + `\n\nSource: ${entry.source}`).join('\n\n')
    saveTextToFile('SAMPLE-process-brief.md', text)
    setNotice('Sample download requested. No project data was accessed.')
  }

  const context = (
    <ProcessContext
      key={reset}
      entries={linkedEntries} graph={graph} step={selectedStep} openRecordId={openRecordId}
      editButtonRef={editButton}
      onOpenRecordChange={setOpenRecordId}
      onEditStep={() => selectedStep && navigate({ kind: 'properties', stepId: selectedStep.id })}
      onClearStep={clearStep} onFocusStep={focusStep} onDiscuss={discuss} onDownload={download}
      onAssignOwner={(name) => {
        setEntries((current) => current.map((entry) => entry.id === 'cover-risk' ? {
          ...entry, summary: `${name} · late payment exposure`,
          details: entry.details.map((detail) => detail.label === 'Owner' ? { ...detail, value: name } : detail),
        } : entry))
        setNotice(`Sample risk assigned to ${name} locally. Nothing saved to your project.`)
      }}
    />
  )

  const properties = editor && editingStep && (
    <StepProperties
      key={editor.stepId}
      step={editingStep} values={editor.values} lanes={graph.lanes} people={people}
      dirty={dirty} leaving={pending !== null}
      onChange={(values) => setEditor({ ...editor, values })}
      onSave={(step) => {
        const oldLane = graph.lanes.findIndex((lane) => lane.id === editingStep.laneId)
        const newLane = graph.lanes.findIndex((lane) => lane.id === step.laneId)
        setGraph((current) => ({
          ...current, revision: current.revision + 1,
          nodes: current.nodes.map((item) => item.id === step.id
            ? { ...step, y: item.y + (newLane - oldLane) * LANE_HEIGHT } : item),
        }))
        setEditor(null)
        setPending(null)
        setNotice(`Saved "${step.label}" properties locally. No project or model was contacted.`)
        requestAnimationFrame(() => editButton.current?.focus())
      }}
      onCancel={() => {
        goTo({ kind: 'context', stepId: editor.stepId })
        setNotice('Property draft cancelled. The sample block did not change.')
      }}
      onRequestClose={() => navigate({ kind: 'context', stepId: editor.stepId })}
      onDiscard={() => {
        if (pending) goTo(pending)
        setNotice('Unsaved property changes discarded locally.')
      }}
      onKeepEditing={() => setPending(null)}
    />
  )

  const openItems = entries.filter(isOpenItem).length

  return (
    <div className="flex min-h-dvh flex-col bg-kumo-base text-kumo-default lg:h-dvh lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-kumo-line bg-kumo-tint px-5 py-2 text-[11px]">
        <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wider"><Flask size={13} aria-hidden />UI design review</span>
        <span className="flex-1 text-kumo-subtle">Fictional data · zero AI calls · changes reset on refresh</span>
        <Button size="sm" variant="ghost" onClick={() => {
          setEntries(SAMPLE_ENTRIES)
          setGraph(SAMPLE_GRAPH)
          setEditor(null)
          setPending(null)
          setDecision('pending')
          setDraft('')
          setNotes([])
          setSelectedStepId(null)
          setOpenRecordId(null)
          setReset((current) => current + 1)
          setNotice('Sample reset. No real project was changed.')
        }}><ArrowCounterClockwise size={13} aria-hidden />Reset sample</Button>
      </div>
      <header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-kumo-line px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-kumo-tint text-kumo-brand"><Sparkle size={20} aria-hidden /></span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-kumo-subtle">BA Studio / process owner view</p>
            <h1 className="mt-0.5 truncate text-base font-semibold tracking-tight sm:text-lg">Supplier invoice approval</h1>
          </div>
        </div>
        <div className="min-w-0 w-full overflow-x-auto sm:w-auto"><PhaseIndicator progress={{ phase: 'map' }} /></div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div ref={conversation} className="min-h-0 lg:flex lg:shrink-0">
          <SampleConversation
            key={reset}
            draft={draft} notes={notes} decision={decision}
            steps={graph.nodes} focusedStepId={selectedStep?.id ?? null}
            onDraftChange={setDraft}
            onAddNote={() => {
              if (!draft.trim()) return
              setNotes((current) => [...current, draft.trim()])
              setDraft('')
              setNotice('Design note added locally. No model call made; refresh clears it.')
            }}
            onDecide={decide} onFocusStep={focusStep} onOpenRecord={openRecord}
          />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <section aria-label="Sample process map" className="flex min-h-[360px] flex-1 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-kumo-line px-5 py-3">
              <div>
                <h2 className="text-[13px] font-semibold">How it works today</h2>
                <p className="mt-0.5 text-[11px] text-kumo-subtle">Working understanding · not yet validated</p>
              </div>
              <p className="text-[11px] text-kumo-subtle">
                {graph.nodes.length} steps · {graph.lanes.length} teams · {openItems} open · select a step to focus, double-click to edit
              </p>
            </div>
            <div className="h-[340px] min-h-[300px] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
              <ProcessMap
                key={reset}
                graph={displayGraph}
                preview={decision === 'pending' ? SAMPLE_PREVIEW : null}
                readOnly
                focusStepId={selectedStep?.id ?? null}
                openItemCounts={countOpenItems(entries)}
                onOps={() => ({ ok: false, reason: 'The design review map is read-only.' })}
                onTidy={() => setNotice('The sample map is read-only.')}
                onPickStep={(step) => focusStep(step.id)}
                onClearStep={clearStep}
                onOpenStepProperties={(step) => navigate({ kind: 'properties', stepId: step.id })}
              />
            </div>
          </section>
          {compact && <div className="h-[560px] shrink-0 border-t border-kumo-line lg:h-[48%]">{context}</div>}
        </div>
        {!compact && (properties || <div className="w-[360px] shrink-0 border-l border-kumo-line xl:w-[384px]">{context}</div>)}
        {compact && properties}
      </main>
      <footer role="status" className="shrink-0 border-t border-kumo-line bg-kumo-elevated px-5 py-2 text-[11px] text-kumo-subtle">{notice}</footer>
    </div>
  )
}
