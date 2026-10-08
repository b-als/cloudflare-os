import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
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
import ProcessCanvas from '../ba-studio/ProcessCanvas'
import ProcessStarterPrompts from '../ba-studio/ProcessStarterPrompts'
import type { QueueView } from '../ba-studio/opQueue'
import { useProcessProject } from '../ba-studio/useProcessStudio'
import { useWorkspacePeople } from '../ba-studio/useWorkspacePeople'
import { Pill } from '../ba-studio/ui'

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

function ProjectLayout() {
  const { workspaceId } = Route.useParams()
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
  const { view, loadError, live, applyOps, retry, layout, recordDecision, resolveQuestion, pendingPreview } =
    useProcessProject(workspace.overseer)
  const [shareOpen, setShareOpen] = useState(false)
  const [decisionsOpen, setDecisionsOpen] = useState(false)
  const [chatId, setChatId] = useState<number | null>(null)
  const [seed, setSeed] = useState({ text: '', nonce: 0 })
  const [chatCount, setChatCount] = useState<number | null>(null)
  const [interviewStarted, setInterviewStarted] = useState(false)
  const [currentUser, setCurrentUser] = useState<AiChatAuthorInfo | null>(null)
  useEffect(() => {
    authenticatedApi.whoami().then(setCurrentUser).catch(() => {})
  }, [authenticatedApi])
  const people = useWorkspacePeople(workspace.overseer, currentUser)

  const conflict = view?.saveStatus === 'conflict' ? view.error : undefined
  useEffect(() => {
    if (conflict) toastsRef.current.add({ title: `Your last change was not saved: ${conflict}`, variant: 'error' })
  }, [conflict])

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
  // Locked/get-started state until the first conversation exists, regardless of graph content:
  // the agent may spend its first turn just asking a clarifying question before drawing anything.
  const needsStart = chatCount === 0 && !interviewStarted
  const startInterview = (prompt: string) => {
    setInterviewStarted(true)
    setSeed((prev) => ({ text: prompt, nonce: prev.nonce + 1 }))
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-line px-5 py-3">
        <div className="min-w-0">
          <p className="text-[12px] text-kumo-subtle">
            <Link to="/ba-projects" className="hover:text-kumo-default">BA Projects</Link>
          </p>
          <h1 className="truncate text-[18px] font-semibold text-kumo-default">{workspace.metadata?.title ?? snapshot.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {live && <Pill tone="info" title="Changes from other editors appear as they happen">Live</Pill>}
          <SaveStatus view={view} onRetry={retry} />
          <CoverageBadge graph={snapshot.graph} />
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
      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        <main aria-label="Process map" className="min-h-[400px] min-w-0 flex-1 p-3">
          <ProcessCanvas
            graph={snapshot.graph}
            decisions={snapshot.decisions}
            pendingPreview={pendingPreview}
            people={people}
            authenticatedApi={authenticatedApi}
            readOnly={false}
            onOps={applyOps}
            onLayout={() => {
              layout().then((result) => {
                if (result && !result.ok) toastsRef.current.add({ title: result.reason, variant: 'error' })
              })
            }}
            onRecordDecision={recordDecision}
          />
        </main>
        <div className="flex h-[420px] w-full shrink-0 flex-col overflow-hidden border-l border-kumo-line lg:h-auto lg:w-[400px]">
          {workspace.overseer && (
            <>
              {needsStart && (
                <ProcessStarterPrompts
                  processName={workspace.metadata?.title ?? snapshot.name}
                  onStart={startInterview}
                />
              )}
              <ChatInterface
                overseer={workspace.overseer.stub}
                selectedChatId={chatId}
                onNavigateToChat={setChatId}
                onChatCountChange={setChatCount}
                seedText={seed.text}
                seedNonce={seed.nonce}
                autoSend
                newChatBlockedReason={needsStart ? 'Pick how to start above' : undefined}
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
        {decisionsOpen && (
          <DecisionsDrawer
            decisions={snapshot.decisions}
            openQuestions={snapshot.openQuestions}
            stakeholders={snapshot.stakeholders}
            interviewTargetStakeholderId={snapshot.interviewTargetStakeholderId}
            workspacePeople={people}
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
  )
}
