import { useCallback, useEffect, useState } from 'react'
import type { GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import type { RpcStub } from 'capnweb'
import type { Overseer } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from './AuthContext'
import { useNavigate } from '@tanstack/react-router'
import SandboxedGatekeeperApp from './SandboxedGatekeeperApp'
import { reportIssue } from './errorReporting'

// The frame's `ui` is an RPC stub at runtime; dispose it to release the server-side capability.
function disposeFrame(frame: GatekeeperUiFrame | null) {
  (frame?.ui as { [Symbol.dispose]?(): void } | undefined)?.[Symbol.dispose]?.()
}

// BA Studio's gatekeeper vendor id (see packages/custom-gatekeeper). Used to show an "AI agent"
// entry point above the sandboxed app: BA Studio's forms are a live view of artifacts, but the
// primary, intended way to build them is a conversation with the platform's real chat/tool-calling
// agent (the same one used to build Gadgets), not manual data entry.
const BA_STUDIO_APP_ID = 'custom'

function baAgentOpeningMessage(): string {
  return [
    "Act as my BA Studio agent. I'm opening BA Studio and want to work through it conversationally instead of filling in forms myself.",
    '',
    "First, connect to the `custom` gatekeeper vendor if you don't already have it as a binding (requestConnection with vendorId \"custom\"), then in executeCode call:",
    '`env.CUSTOM.initialiseBaSession({ projectName: "Untitled project", stakeholders: [], mode: "interview" })`',
    '',
    'Use the returned `agentSystemPrompt` as your own operating instructions for the rest of this conversation, and send the returned `agentOpeningMessage` to me as your next message (verbatim, then continue naturally from there). Ask me what the project is called and what processId to use before doing anything else.',
    '',
    'As we talk, keep the BA Studio artifact bundle up to date for that processId: read it with env.CUSTOM.getBaProject(processId), and whenever I confirm a requirement, conflict, process step, trade-off, or sign-off, write the updated bundle back with env.CUSTOM.saveBaProject(processId, bundle) so it shows up immediately in BA Studio and Workflow Studio. If a bundle for this project does not exist yet, start from env.CUSTOM.getWorkflowStudioDemoV11() as a template shape, replacing it with real content.',
    '',
    'Never contact stakeholders yourself — only log suggestions for me to act on. Ask me one focused question at a time.',
  ].join('\n')
}

// Renders a gatekeeper's full-page management app (a sandboxed SPA the gatekeeper serves).
// Fetches the app frame (iframe HTML + `ui` capability) from the backend and hosts it.
export default function GatekeeperAppPage({ appId }: { appId: string }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const navigate = useNavigate()
  // Wrap the frame in an object: it holds a `ui` RPC stub, and we never want useState's setter to
  // treat a stored value as an updater function.
  const [state, setState] = useState<{ frame: GatekeeperUiFrame } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [startingAgent, setStartingAgent] = useState(false)

  useEffect(() => {
    let cancelled = false
    let acquired: GatekeeperUiFrame | null = null
    // Some gatekeepers (e.g. BA Studio / "custom") are ambient ("optional") vendors: they
    // auto-provision an account on demand rather than being force-enabled for every user, so a
    // fresh user has no account for them yet and getGatekeeperApp() returns null. Provision it
    // explicitly (idempotent) before giving up, mirroring the Connectors page's "Add" flow and
    // Workflow Studio's own fetch logic (see routes/gatekeepers.tsx, routes/workflow-studio.tsx).
    authenticatedApi
      .getGatekeeperApp(appId)
      .then(async (frame) => {
        if (frame) return frame
        await authenticatedApi.provisionAmbientAccount(appId)
        return authenticatedApi.getGatekeeperApp(appId)
      })
      .then((frame) => {
        if (!frame) {
          if (!cancelled) setError('This app is not available on this deployment.')
          return
        }
        if (cancelled) {
          disposeFrame(frame)
          return
        }
        acquired = frame
        setState({ frame })
      })
      .catch((err) => {
        console.error('Failed to load gatekeeper app:', err)
        reportIssue('gatekeeper-app.load', err, {
          gatekeeperVendorId: appId,
        })
        if (!cancelled) setError(`${err}`)
      })
    return () => {
      cancelled = true
      disposeFrame(acquired)
    }
  }, [authenticatedApi, appId])

  // Hands off to the platform's real agent/tool-calling chat loop (the same one used to build
  // Gadgets), using the same `newGadget()` + `newChat()` + navigate pattern the homepage uses.
  // This is BA Studio's primary, chat-driven entry point; the sandboxed app below remains a live,
  // directly-editable view of whatever artifacts the conversation (or the user) has produced.
  const startBaAgentChat = useCallback(async () => {
    setStartingAgent(true)
    let stub: RpcStub<Overseer> | null = null
    try {
      stub = authenticatedApi.newGadget()
      const [chat, { id }] = await Promise.all([
        stub.newChat(baAgentOpeningMessage(), null),
        stub.getMetadata(),
      ])
      navigate({ to: '/workspace/$id', params: { id }, search: { chat } })
    } catch (err) {
      console.error('Failed to start BA Studio agent chat:', err)
      reportIssue('gatekeeper-app.start-agent-chat', err, { gatekeeperVendorId: appId })
    } finally {
      stub?.[Symbol.dispose]()
      setStartingAgent(false)
    }
  }, [authenticatedApi, navigate, appId])

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-kumo-subtle">{error}</div>
    )
  }
  if (!state) {
    return <div className="px-4 py-16 text-center text-sm text-kumo-subtle">Loading…</div>
  }

  const showBaAgentEntry = appId === BA_STUDIO_APP_ID

  // Fill the viewport below the header so the embedded app can manage its own internal layout.
  return (
    <div style={{ height: 'calc(100vh - 56px)' }} className="flex flex-col">
      {showBaAgentEntry && (
        <div className="flex items-center justify-between gap-3 border-b border-kumo-line bg-kumo-elevated px-4 py-2">
          <p className="text-[12px] text-kumo-subtle">
            Talk to the BA agent to discover requirements conversationally — it fills in the forms
            below as you talk. You can still edit directly if you prefer.
          </p>
          <button
            type="button"
            onClick={() => void startBaAgentChat()}
            className="shrink-0 rounded-lg bg-emerald-400/20 px-3 py-1.5 text-[12px] font-medium text-emerald-200"
            disabled={startingAgent}
          >
            {startingAgent ? 'Starting agent…' : 'Talk to the BA agent'}
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <SandboxedGatekeeperApp frame={state.frame} gatekeeperVendorId={appId} />
      </div>
    </div>
  )
}
