import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useKumoToastManager } from '@cloudflare/kumo'
import { ShareNetwork } from '@phosphor-icons/react'
import type { AiChatAuthorInfo } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../AuthContext'
import ObserverConfigModal from '../ObserverConfigModal'
import ShareModal from '../ShareModal'
import { useWorkspaceOpen } from '../useWorkspaceOpen'
import AgentPanel from '../ba-studio/AgentPanel'
import ProcessCanvas from '../ba-studio/ProcessCanvas'
import type { QueueView } from '../ba-studio/opQueue'
import { useProcessProject } from '../ba-studio/useProcessStudio'
import { Pill } from '../ba-studio/ui'

/** Focused process-mapping workspace: the project's live canvas beside the BA agent preview. */
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
  const { view, loadError, live, applyOps, retry } = useProcessProject(workspace.overseer)
  const [shareOpen, setShareOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState<AiChatAuthorInfo | null>(null)
  useEffect(() => {
    authenticatedApi.whoami().then(setCurrentUser).catch(() => {})
  }, [authenticatedApi])

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
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main aria-label="Process map" className="min-h-[400px] min-w-0 flex-1 p-3">
          <ProcessCanvas graph={snapshot.graph} readOnly={false} onOps={applyOps} />
        </main>
        <div className="flex h-[320px] w-full shrink-0 flex-col lg:h-auto lg:w-[340px]">
          <p className="border-b border-l border-kumo-line bg-kumo-tint/60 px-3 py-1.5 text-[11px] text-kumo-subtle">
            Preview: the agent is not connected to this project yet.
          </p>
          <div className="min-h-0 flex-1">
            <AgentPanel stage="to-be" />
          </div>
        </div>
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
