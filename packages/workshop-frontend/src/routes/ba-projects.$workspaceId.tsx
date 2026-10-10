import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useKumoToastManager } from '@cloudflare/kumo'
import { ShareNetwork } from '@phosphor-icons/react'
import type { AiChatAuthorInfo } from '@gadgets/workshop-shared/api'
import type { ProcessNode } from '@gadgets/gatekeeper-process/types'
import { useAuthenticatedApi } from '../AuthContext'
import ChatInterface from '../ChatInterface'
import ObserverConfigModal from '../ObserverConfigModal'
import ShareModal from '../ShareModal'
import { useDocumentTitle } from '../useDocumentTitle'
import { useWorkspaceOpen } from '../useWorkspaceOpen'
import { WorkshopButton } from '../components/WorkshopControls'
import { forgetOpening, openingMessage, readOpening } from '../ba-studio/opening'
import { PhaseIndicator } from '../ba-studio/PhaseIndicator'
import { phaseOf } from '../ba-studio/phase'
import ProcessMap from '../ba-studio/ProcessMap'
import { useProcessProject } from '../ba-studio/useProcessProject'

/** Session: the conversation with the analyst, and the process map it draws. */
export const Route = createFileRoute('/ba-projects/$workspaceId')({
  component: SessionPage,
})

type Seed = { text: string; nonce: number; autoSend?: boolean }

function SessionPage() {
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
  const { view, loadError, pendingPreview, applyOps, retry, layout } = useProcessProject(workspace.overseer)

  // A new project arrives with the person's opening words, sent as the first message.
  const [seed, setSeed] = useState<Seed | null>(() => {
    const opening = readOpening(workspaceId)
    return opening ? { text: openingMessage(opening), nonce: 1, autoSend: true } : null
  })
  const onSeedApplied = useCallback((nonce: number) => {
    forgetOpening(workspaceId)
    setSeed((current) => (current?.nonce === nonce ? null : current))
  }, [workspaceId])
  const pickStep = useCallback((step: ProcessNode) => {
    setSeed((current) => ({ text: `About “${step.label}”: `, nonce: (current?.nonce ?? 1) + 1 }))
  }, [])

  // One conversation per process: reopen the latest, unless an opening is about to start one.
  const [chatId, setChatId] = useState<number | null>(null)
  const startsNewChat = useRef(seed?.autoSend === true)
  useEffect(() => {
    const overseer = workspace.overseer
    if (!overseer || startsNewChat.current) return
    let cancelled = false
    overseer.stub.listChats().then((chats) => {
      const latest = chats.toSorted((a, b) => b.lastActive.getTime() - a.lastActive.getTime())[0]
      if (!cancelled && latest) setChatId((current) => current ?? latest.id)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [workspace.overseer])

  const [currentUser, setCurrentUser] = useState<AiChatAuthorInfo | null>(null)
  useEffect(() => {
    authenticatedApi.whoami().then(setCurrentUser).catch(() => {})
  }, [authenticatedApi])
  const [inviting, setInviting] = useState(false)

  const conflict = view?.saveStatus === 'conflict' ? view.error : undefined
  useEffect(() => {
    if (conflict) toastsRef.current.add({ title: conflict, variant: 'error' })
  }, [conflict])

  const name = workspace.metadata?.title ?? view?.snapshot.name ?? ''
  useDocumentTitle(name || 'BA Projects')

  if (workspace.error || loadError) {
    return (
      <p role="alert" className="mx-auto max-w-md px-6 py-16 text-center text-[14px] text-kumo-subtle">
        This process couldn't be opened. It may not exist, or you may not have access.
      </p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-12 items-center gap-4 border-b border-kumo-line px-5 py-2">
        <h1 className="min-w-0 max-w-[40%] truncate text-[15px] font-semibold text-kumo-default">{name}</h1>
        {view && <PhaseIndicator progress={phaseOf(view.snapshot.graph)} />}
        {workspace.metadata && !workspace.metadata.owner && (
          <WorkshopButton className="ml-auto" onClick={() => setInviting(true)}>
            <ShareNetwork size={14} aria-hidden />
            Invite
          </WorkshopButton>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section aria-label="Conversation" className="flex h-[55vh] min-h-0 shrink-0 flex-col border-kumo-line lg:h-auto lg:w-[440px] lg:border-r">
          {workspace.overseer && (
            <ChatInterface
              workspaceId={workspaceId}
              overseer={workspace.overseer.stub}
              selectedChatId={chatId}
              onNavigateToChat={setChatId}
              seed={seed}
              onSeedApplied={onSeedApplied}
              agentRequired
              pendingConsoleLogCount={0}
              consoleLogPreview=""
              consoleLogSeverity="info"
              onConsumeConsoleLogs={() => ''}
              onDiscardConsoleLogs={() => {}}
              onOpenGadget={() => navigate({ to: '/workspace/$id', params: { id: workspaceId } })}
              outputOfWorkpiece={() => undefined}
            />
          )}
        </section>

        <section aria-label="Process map" className="relative min-h-[320px] min-w-0 flex-1">
          {view ? (
            <ProcessMap
              graph={view.snapshot.graph}
              preview={pendingPreview}
              readOnly={false}
              onOps={applyOps}
              onTidy={() => {
                layout().then((result) => {
                  if (result && !result.ok) toastsRef.current.add({ title: result.reason, variant: 'error' })
                }).catch(() => toastsRef.current.add({ title: "Couldn't tidy the map.", variant: 'error' }))
              }}
              onPickStep={pickStep}
            />
          ) : (
            <p className="p-6 text-[13px] text-kumo-inactive">Opening the map…</p>
          )}
          {view?.saveStatus === 'error' && (
            <div role="alert" className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-kumo-danger bg-kumo-base px-4 py-1.5 text-[12px] text-kumo-danger shadow-sm">
              Your last edit didn't save.
              <WorkshopButton onClick={retry}>Retry</WorkshopButton>
            </div>
          )}
        </section>
      </div>

      {workspace.overseer && workspace.metadata && (
        <ShareModal
          open={inviting}
          onClose={() => setInviting(false)}
          overseer={workspace.overseer.stub}
          metadata={workspace.metadata}
          currentUser={currentUser}
          authenticatedApi={authenticatedApi}
          openPath={`/ba-projects/${workspaceId}`}
        />
      )}
      {workspace.observerConfig && (
        <ObserverConfigModal
          needs={workspace.observerConfig.needs}
          authenticatedApi={authenticatedApi}
          onConfirm={workspace.observerConfig.resolve}
          onCancel={workspace.cancelObserverConfig}
        />
      )}
    </div>
  )
}
