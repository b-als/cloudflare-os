import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import ChatInterface from '../ChatInterface'
import { useAuthenticatedApi } from '../AuthContext'
import { useWorkspaceOpen } from '../useWorkspaceOpen'
import { useDocumentTitle } from '../useDocumentTitle'
import { reportIssue } from '../errorReporting'
import { interviewResourceFrom, openInterviewWorkspace } from '../ba-studio/interviewWorkspace'

/** The charter's third surface: an isolated stakeholder conversation, without map-edit authority. */
export const Route = createFileRoute('/ba-projects/interview')({
  validateSearch: (search: Record<string, unknown>): { workspace?: string } => ({
    workspace: typeof search.workspace === 'string' ? search.workspace : undefined,
  }),
  component: () => <InterviewPage />,
})

const InterviewPage = () => {
  const { authenticatedApi } = useAuthenticatedApi()
  const location = useRouterState({ select: state => state.location })
  const workspace = location.search.workspace
  const fragment = location.hash
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const created = useRef(false)
  useDocumentTitle('Stakeholder interview')

  useEffect(() => {
    setError(null)
    if (workspace) return
    let cancelled = false
    const open = async () => {
      const resource = interviewResourceFrom(fragment)
      const id = await openInterviewWorkspace(authenticatedApi, resource)
      if (cancelled) return
      created.current = true
      await navigate({ to: '/ba-projects/interview', search: { workspace: id }, hash: '', replace: true })
    }
    open().catch((err: unknown) => {
      if (!cancelled) {
        reportIssue('ba-studio.interview-open', err)
        setError("This interview couldn't be opened. Its invitation may have expired or the question may be closed.")
      }
    })
    return () => { cancelled = true }
  }, [authenticatedApi, workspace, fragment, navigate])

  if (error && !workspace) return <p role="alert" className="p-6 text-kumo-danger">{error}</p>
  if (!workspace) return <p className="p-6 text-kumo-subtle">Opening your interview…</p>
  return <InterviewConversation key={workspace} workspaceId={workspace} opening={created.current} />
}

const InterviewConversation = ({ workspaceId, opening }: { workspaceId: string; opening: boolean }) => {
  const { authenticatedApi } = useAuthenticatedApi()
  const navigate = useNavigate()
  const [chatId, setChatId] = useState<number | null>(null)
  const [chatError, setChatError] = useState(false)
  const [seed, setSeed] = useState<{ nonce: number; text: string; autoSend: boolean } | null>(() => opening ? {
    nonce: 1, autoSend: true,
    text: "I'm ready for my stakeholder interview. Read the PROCESS_INTERVIEW binding's instructions and assigned question, then ask me about it. Record my account without changing the agreed process.",
  } : null)
  const workspace = useWorkspaceOpen({
    id: workspaceId, authenticatedApi, onMetadata: () => {},
    onShareKeyConsumed: () => {},
    onInvalidShareKey: () => {},
  })
  useEffect(() => {
    if (!workspace.overseer || opening) return
    let cancelled = false
    workspace.overseer.stub.listChats().then((chats) => {
      if (cancelled) return
      const latest = chats.toSorted((a, b) => b.lastActive.getTime() - a.lastActive.getTime())[0]
      setChatId(latest?.id ?? null)
      if (!latest) setSeed({
        nonce: 1, autoSend: true,
        text: "I'm ready for my stakeholder interview. Read PROCESS_INTERVIEW and ask me the assigned question.",
      })
    }).catch((err: unknown) => {
      reportIssue('ba-studio.interview-chat', err)
      if (!cancelled) setChatError(true)
    })
    return () => { cancelled = true }
  }, [workspace.overseer, opening])

  if (workspace.error) return <p role="alert" className="p-6 text-kumo-danger">You don't have access to this interview.</p>
  if (chatError) return <p role="alert" className="p-6 text-kumo-danger">Your interview conversation couldn't be loaded. Please reload to try again.</p>
  return (
    <section aria-label="Stakeholder interview" className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
      <h1 className="border-b border-kumo-line px-5 py-3 text-lg font-semibold text-kumo-default">Your conversation with the analyst</h1>
      {workspace.overseer && (
        <ChatInterface
          workspaceId={workspaceId} overseer={workspace.overseer.stub}
          selectedChatId={chatId} onNavigateToChat={setChatId}
          seed={seed} onSeedApplied={() => setSeed(null)} agentRequired
          pendingConsoleLogCount={0} consoleLogPreview="" consoleLogSeverity="info"
          onConsumeConsoleLogs={() => ''} onDiscardConsoleLogs={() => {}}
          onOpenGadget={() => navigate({ to: '/ba-projects/interview', search: { workspace: workspaceId } })}
          outputOfWorkpiece={() => undefined}
        />
      )}
    </section>
  )
}
