import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createFileRoute, Link, useLocation, useNavigate } from '@tanstack/react-router'
import { useKumoToastManager } from '@cloudflare/kumo'
import { ListChecks, ShareNetwork } from '@phosphor-icons/react'
import type { AiChatAuthorInfo } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../AuthContext'
import ChatInterface from '../ChatInterface'
import ObserverConfigModal from '../ObserverConfigModal'
import ShareModal from '../ShareModal'
import { useWorkspaceOpen } from '../useWorkspaceOpen'
import CoverageBadge from '../ba-studio/CoverageBadge'
import DecisionsDrawer from '../ba-studio/DecisionsDrawer'
import { interviewOpening, stageAskPrompt } from '../ba-studio/interview'
import ProcessCanvas from '../ba-studio/ProcessCanvas'
import type { QueueView } from '../ba-studio/opQueue'
import { useProcessProject } from '../ba-studio/useProcessStudio'
import { useWorkspacePeople } from '../ba-studio/useWorkspacePeople'
import { Pill } from '../ba-studio/ui'
import LifecyclePanel from '../ba-studio/LifecyclePanel'
import { liveProjectView } from '../ba-studio/liveProject'
import { ProjectContext, type TraceFocus } from '../ba-studio/ProjectContext'
import { STAGES, isStageId } from '../ba-studio/stages'
import AsIsStage from '../ba-studio/stages/AsIsStage'
import HandoffStage from '../ba-studio/stages/HandoffStage'
import MonitorStage from '../ba-studio/stages/MonitorStage'
import OutcomesStage from '../ba-studio/stages/OutcomesStage'
import RequirementsStage from '../ba-studio/stages/RequirementsStage'
import SignoffStage from '../ba-studio/stages/SignoffStage'
import StakeholdersStage from '../ba-studio/stages/StakeholdersStage'
import ToBeStage from '../ba-studio/stages/ToBeStage'
import TradeoffsStage from '../ba-studio/stages/TradeoffsStage'
import ValidateStage from '../ba-studio/stages/ValidateStage'
import TraceabilityDrawer from '../ba-studio/TraceabilityDrawer'
import type { StageId } from '../ba-studio/prototype'
import { applyLifecycleOps, emptyLifecycle } from '@gadgets/gatekeeper-process/lifecycle'
import { layoutGraph } from '@gadgets/gatekeeper-process/graph-ops'
import type { GraphOp } from '@gadgets/gatekeeper-process/types'
import { reportIssue } from '../errorReporting'

/** Focused process-mapping workspace: the project's live canvas beside the workspace's AI chat. */
export const Route = createFileRoute('/ba-projects/$workspaceId')({
  component: ProjectLayout,
})

function SaveStatus({ view, onRetry }: { view: QueueView; onRetry: () => void }) {
  switch (view.saveStatus) {
    case 'saved':
      return <Pill tone="success">Saved · rev {view.revision}</Pill>
    case 'saving':
      return <Pill>Saving…</Pill>
    case 'conflict':
      return (
        <Pill tone="warning" title={view.error}>
          Conflict — reloaded latest
        </Pill>
      )
    case 'error':
      return (
        <span title={view.error} className="inline-flex items-center gap-1.5">
          <Pill tone="danger">Couldn't save</Pill>
          <button type="button" onClick={onRetry} className="text-[12px] font-medium text-kumo-brand hover:underline">
            Retry
          </button>
        </span>
      )
  }
}

function Message({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-kumo-subtle">
      {children}{' '}
      <Link to="/ba-projects" className="text-kumo-brand hover:underline">
        Back to BA Projects
      </Link>
    </div>
  )
}

function LiveStage({ stage }: { stage: StageId }) {
  switch (stage) {
    case 'outcomes': return <OutcomesStage />
    case 'stakeholders': return <StakeholdersStage />
    case 'as-is': return <AsIsStage />
    case 'requirements': return <RequirementsStage />
    case 'to-be': return <ToBeStage />
    case 'tradeoffs': return <TradeoffsStage />
    case 'validate': return <ValidateStage />
    case 'signoff': return <SignoffStage />
    case 'handoff': return <HandoffStage />
    case 'monitor': return <MonitorStage />
    default: {
      const unreachable: never = stage
      return unreachable
    }
  }
}

function InterviewOpener({
  workspaceId, processName, chatCount, onOpen,
}: {
  workspaceId: string
  processName: string
  chatCount: number | null
  onOpen: (prompt: string) => void
}) {
  const openedWorkspace = useRef<string | null>(null)
  useEffect(() => {
    if (chatCount !== 0 || openedWorkspace.current === workspaceId) return
    openedWorkspace.current = workspaceId
    onOpen(interviewOpening(processName))
  }, [chatCount, onOpen, processName, workspaceId])
  return null
}

function ProjectLayout() {
  const { workspaceId } = Route.useParams()
  const pathname = useLocation({ select: (location) => location.pathname })
  const requestedStage = pathname.split('/').filter(Boolean)[2]
  const stage = requestedStage && isStageId(requestedStage) ? requestedStage : 'as-is'
  const model = stage === 'to-be' ? 'toBe' : 'asIs'
  const { authenticatedApi } = useAuthenticatedApi()
  const navigate = useNavigate()
  const toasts = useKumoToastManager()
  const toastsRef = useRef(toasts)
  useEffect(() => {
    toastsRef.current = toasts
  })
  const workspace = useWorkspaceOpen({
    id: workspaceId,
    authenticatedApi,
    onMetadata: () => {},
    onShareKeyConsumed: () => navigate({ to: '/ba-projects/$workspaceId', params: { workspaceId }, replace: true }),
    onInvalidShareKey: () => toastsRef.current.add({ title: 'Invalid or expired share link.', variant: 'error' }),
  })
  const {
    view, loadError, live, applyOps, retry, layout, recordDecision, resolveQuestion, pendingPreview,
    lifecycleSaving, saveLifecycle, createBaseline,
  } = useProcessProject(workspace.overseer, model)
  const [shareOpen, setShareOpen] = useState(false)
  const [decisionsOpen, setDecisionsOpen] = useState(false)
  const [chatId, setChatId] = useState<number | null>(null)
  const [seed, setSeed] = useState({ text: '', nonce: 0 })
  const [chatCount, setChatCount] = useState<number | null>(null)
  const [traceFocus, setTraceFocus] = useState<TraceFocus | null>(null)
  const [currentUser, setCurrentUser] = useState<AiChatAuthorInfo | null>(null)
  useEffect(() => {
    authenticatedApi.whoami().then(setCurrentUser).catch(() => {})
  }, [authenticatedApi])
  const people = useWorkspacePeople(workspace.overseer, currentUser)

  const conflict = view?.saveStatus === 'conflict' ? view.error : undefined
  useEffect(() => {
    if (conflict) toastsRef.current.add({ title: `Your last change was not saved: ${conflict}`, variant: 'error' })
  }, [conflict])

  if (requestedStage && !isStageId(requestedStage)) return <Message>Unknown lifecycle stage.</Message>
  if (workspace.error || loadError) {
    return <Message>This project could not be opened. It may not exist, or you may not have access.</Message>
  }
  if (!view) {
    return (
      <>
        <p className="py-16 text-center text-sm text-kumo-subtle">Loading project…</p>
        {workspace.observerConfig && (
          <ObserverConfigModal
            needs={workspace.observerConfig.needs}
            authenticatedApi={authenticatedApi}
            onConfirm={workspace.observerConfig.resolve}
            onCancel={workspace.cancelObserverConfig}
          />
        )}
      </>
    )
  }

  const { snapshot } = view
  const lifecycle = snapshot.lifecycle ?? emptyLifecycle(snapshot.graph.revision)
  const graph = model === 'toBe' ? lifecycle.toBe : snapshot.graph
  const reportSaveError = (error: unknown) => {
    reportIssue('ba-lifecycle.canvas-save', error, { gatekeeperVendorId: 'process' })
    toastsRef.current.add({ title: error instanceof Error ? error.message : String(error), variant: 'error' })
  }
  const saveTargetOps = (ops: GraphOp[]) => {
    if (lifecycleSaving || view.saveStatus !== 'saved') return { ok: false as const, reason: 'Wait for outstanding changes to save.' }
    try {
      const active = snapshot.decisions.filter((decision) =>
        decision.model === 'toBe' && decision.locked && decision.status === 'active')
      applyLifecycleOps(lifecycle, [], ops, {
        lockedNodeIds: active.flatMap((decision) => decision.nodeIds),
        lockedEdgeIds: active.flatMap((decision) => decision.edgeIds),
      })
    } catch (error) {
      return { ok: false as const, reason: error instanceof Error ? error.message : String(error) }
    }
    void saveLifecycle([], ops, view.revision).catch(reportSaveError)
    return { ok: true as const }
  }
  const processName = workspace.metadata?.title ?? snapshot.name
  const projectView = liveProjectView(snapshot, workspaceId)
  const openInterview = (prompt: string) => {
    setSeed((prev) => ({ text: prompt, nonce: prev.nonce + 1 }))
  }
  const askAboutStage = (next: StageId) => {
    setSeed((prev) => ({ text: stageAskPrompt(next, processName), nonce: prev.nonce + 1 }))
  }
  return (
    <ProjectContext.Provider value={{ project: projectView, trace: setTraceFocus, askAboutStage, persistence: 'live' }}>
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-line px-5 py-3">
        <div className="min-w-0">
          <p className="text-[12px] text-kumo-subtle">
            <Link to="/ba-projects" className="hover:text-kumo-default">BA Projects</Link>
          </p>
          <h1 className="truncate text-[18px] font-semibold text-kumo-default">{processName}</h1>
          <p className="text-[12px] text-kumo-subtle">
            Saved on this project, revision {view.revision}. The chat transcript is separate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {live && <Pill tone="info" title="Changes from other editors appear as they happen">Live</Pill>}
          {lifecycleSaving ? <Pill>Saving lifecycle...</Pill> : <SaveStatus view={view} onRetry={retry} />}
          <CoverageBadge graph={graph} />
          <button
            type="button"
            onClick={() => setDecisionsOpen((open) => !open)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium ${
              decisionsOpen ? 'bg-kumo-brand/15 text-kumo-brand' : 'border border-kumo-line text-kumo-default hover:bg-kumo-tint'
            }`}
          >
            <ListChecks size={13} />
            Decisions
            {snapshot.openQuestions.length > 0 && <Pill tone="warning">{snapshot.openQuestions.length}</Pill>}
          </button>
          {workspace.metadata && !workspace.metadata.owner && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-kumo-line px-2.5 text-[12px] font-medium text-kumo-default hover:bg-kumo-tint"
            >
              <ShareNetwork size={13} />
              Share
            </button>
          )}
        </div>
      </header>
      <nav aria-label="BA lifecycle stages" className="flex shrink-0 gap-1 overflow-x-auto border-b border-kumo-line px-3 py-2">
        {STAGES.map((definition) => (
          <Link key={definition.id} to="/ba-projects/$workspaceId/$stage"
            params={{ workspaceId, stage: definition.id }} aria-current={stage === definition.id ? 'page' : undefined}
            className={`shrink-0 rounded px-3 py-1.5 text-xs ${stage === definition.id ? 'bg-kumo-brand/15 text-kumo-brand' : 'text-kumo-subtle hover:bg-kumo-tint'}`}>
            {definition.id === 'handoff' ? 'Hand-off' : definition.label}
          </Link>
        ))}
      </nav>
      {pendingPreview?.conflicts?.length ? (
        <p role="alert" className="border-b border-kumo-line px-5 py-2 text-sm text-kumo-danger">
          Agent proposals conflict with current edits: {pendingPreview.conflicts.join(' ')} Revise or reject those proposals before applying them.
        </p>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        <main aria-label="BA project stage" className="flex min-h-[400px] min-w-0 flex-1 flex-col overflow-auto p-3">
          {stage === 'as-is' || stage === 'to-be' ? <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-kumo-subtle">
            <span>{stage === 'as-is' ? 'Current (as-is) process' : 'Target (to-be) process'} · Model edits are stored separately.</span>
            {model === 'toBe' && !graph.nodes.length && !graph.lanes.length && snapshot.graph.nodes.length > 0 &&
              <button className="rounded border border-kumo-line px-2 py-1" disabled={lifecycleSaving}
                onClick={() => {
                  const ops: GraphOp[] = [
                    ...snapshot.graph.lanes.map((lane): GraphOp => ({ op: 'addLane', lane })),
                    ...snapshot.graph.nodes.map((node): GraphOp => ({ op: 'addNode', node })),
                    ...snapshot.graph.edges.map((edge): GraphOp => ({ op: 'addEdge', edge })),
                  ]
                  const result = saveTargetOps(ops)
                  if (!result.ok) toastsRef.current.add({ title: result.reason, variant: 'error' })
                }}>Copy as-is as a starting point</button>}
          </div>
          <div className="min-h-[400px] flex-1">
          <ProcessCanvas key={model}
            graph={graph}
            decisions={snapshot.decisions.filter((decision) => (decision.model ?? 'asIs') === model)}
            pendingPreview={pendingPreview}
            people={people}
            authenticatedApi={authenticatedApi}
            readOnly={lifecycleSaving}
            onOps={model === 'toBe' ? saveTargetOps : applyOps}
            onLayout={() => {
              if (model === 'toBe') {
                const arranged = layoutGraph(graph)
                const ops: GraphOp[] = arranged.nodes.filter((node) => {
                  const before = graph.nodes.find((entry) => entry.id === node.id)
                  return before?.x !== node.x || before?.y !== node.y
                }).map((node) => ({ op: 'moveNode', id: node.id, x: node.x, y: node.y }))
                if (ops.length) {
                  const result = saveTargetOps(ops)
                  if (!result.ok) toastsRef.current.add({ title: result.reason, variant: 'error' })
                }
                return
              }
              layout().then((result) => {
                if (result && !result.ok) toastsRef.current.add({ title: result.reason, variant: 'error' })
              }).catch(reportSaveError)
            }}
            onRecordDecision={(input) => recordDecision({ ...input, model })}
          />
          </div>
          </> : null}
          <LiveStage stage={stage} />
          {stage !== 'as-is' && stage !== 'to-be' && (
            <LifecyclePanel key={snapshot.projectId} stage={stage} snapshot={snapshot} api={authenticatedApi}
              busy={lifecycleSaving || view.saveStatus !== 'saved'}
              save={(ops, baseRevision) => saveLifecycle(ops, undefined, baseRevision)} createBaseline={createBaseline} />
          )}
        </main>
        <div className="flex h-[420px] w-full shrink-0 flex-col overflow-hidden border-l border-kumo-line lg:h-auto lg:w-[400px]">
          {workspace.overseer && (
            <>
              <InterviewOpener
                workspaceId={workspaceId}
                processName={processName}
                chatCount={chatCount}
                onOpen={openInterview}
              />
              <ChatInterface
                workspaceId={workspaceId}
                overseer={workspace.overseer.stub}
                selectedChatId={chatId}
                onNavigateToChat={setChatId}
                onChatCountChange={setChatCount}
                seedText={seed.text}
                seedNonce={seed.nonce}
                autoSend
                pendingConsoleLogCount={0}
                consoleLogPreview=""
                consoleLogSeverity="info"
                onConsumeConsoleLogs={() => ''}
                onDiscardConsoleLogs={() => {}}
                onOpenGadget={() => navigate({ to: '/workspace/$id', params: { id: workspaceId } })}
                outputOfWorkpiece={() => undefined}
                constrainChatWidth
              />
            </>
          )}
        </div>
        {traceFocus && (
          <TraceabilityDrawer
            project={projectView}
            focus={traceFocus}
            onFocus={setTraceFocus}
            onClose={() => setTraceFocus(null)}
          />
        )}
        {decisionsOpen && (
          <DecisionsDrawer
            decisions={snapshot.decisions}
            openQuestions={snapshot.openQuestions}
            readOnly={false}
            onResolve={(questionId, answer) =>
              resolveQuestion(questionId, answer).catch((err: unknown) =>
                toastsRef.current.add({ title: err instanceof Error ? err.message : String(err), variant: 'error' }),
              )
            }
            onClose={() => setDecisionsOpen(false)}
          />
        )}
      </div>
      {workspace.overseer && workspace.metadata && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          overseer={workspace.overseer.stub}
          metadata={workspace.metadata}
          currentUser={currentUser}
          authenticatedApi={authenticatedApi}
        />
      )}
    </div>
    </ProjectContext.Provider>
  )
}
