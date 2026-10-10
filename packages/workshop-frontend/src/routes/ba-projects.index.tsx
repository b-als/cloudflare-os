import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowRight } from '@phosphor-icons/react'
import { useAuthenticatedApi } from '../AuthContext'
import { useDocumentTitle } from '../useDocumentTitle'
import { reportIssue } from '../errorReporting'
import { WorkshopButton, WorkshopInputArea } from '../components/WorkshopControls'
import { processNameFrom, rememberOpening } from '../ba-studio/opening'
import { createProcessWorkspace, PROCESS_VENDOR_ID } from '../ba-studio/processWorkspace'
import { useRecentProcesses } from '../ba-studio/useRecentProcesses'

/** Start: one question, and the processes already under way. */
export const Route = createFileRoute('/ba-projects/')({
  component: StartPage,
})

const STARTERS = [
  'How a supplier invoice gets approved and paid',
  'How a new hire gets a laptop and accounts on day one',
  'How we handle a customer asking for a refund',
]

function StartPage() {
  useDocumentTitle('BA Projects')
  const { authenticatedApi } = useAuthenticatedApi()
  const navigate = useNavigate()
  const recent = useRecentProcesses(authenticatedApi)
  const [opening, setOpening] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    const words = opening.trim()
    if (!words || starting) return
    setStarting(true)
    setError(null)
    try {
      const workspaceId = await createProcessWorkspace(authenticatedApi, processNameFrom(words))
      rememberOpening(workspaceId, words)
      await navigate({ to: '/ba-projects/$workspaceId', params: { workspaceId } })
    } catch (err) {
      reportIssue('ba-studio.start', err, { gatekeeperVendorId: PROCESS_VENDOR_ID })
      setError(err instanceof Error ? err.message : String(err))
      setStarting(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 pb-12 pt-[12vh]">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void start()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h1 id="start-question" className="text-[26px] font-semibold leading-tight tracking-tight text-kumo-default">
            What process do you want to map or improve?
          </h1>
          <p className="text-[14px] text-kumo-subtle">
            Describe it in your own words. Your analyst drafts the map while you talk.
          </p>
        </div>
        <WorkshopInputArea
          aria-labelledby="start-question"
          autoFocus
          rows={4}
          value={opening}
          disabled={starting}
          onChange={(event) => setOpening(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void start()
            }
          }}
          placeholder="For example: when a supplier sends an invoice, Finance checks it against the purchase order, a manager approves it and we pay at month end."
          className="w-full resize-none text-[14px] leading-[20px]"
        />
        <div className="flex flex-wrap items-center gap-2">
          {STARTERS.map((starter) => (
            <WorkshopButton key={starter} type="button" disabled={starting} onClick={() => setOpening(starter)}>
              {starter}
            </WorkshopButton>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <WorkshopButton tone="primary" type="submit" loading={starting} disabled={!opening.trim()}>
            Start mapping
          </WorkshopButton>
          {error && (
            <p role="alert" className="text-[13px] text-kumo-danger">
              Couldn't start: {error}
            </p>
          )}
        </div>
      </form>

      <section aria-labelledby="recent-heading" className="flex flex-col gap-2">
        <h2 id="recent-heading" className="text-[13px] font-semibold text-kumo-subtle">Recent processes</h2>
        {recent.status === 'loading' && <p className="text-[13px] text-kumo-inactive">Loading…</p>}
        {recent.status === 'error' && (
          <p role="alert" className="text-[13px] text-kumo-danger">Couldn't load your processes: {recent.message}</p>
        )}
        {recent.status === 'ready' && recent.processes.length === 0 && (
          <p className="text-[13px] text-kumo-inactive">Nothing yet. Your first process will appear here.</p>
        )}
        {recent.status === 'ready' && recent.processes.length > 0 && (
          <ul className="divide-y divide-kumo-line rounded-xl border border-kumo-line">
            {recent.processes.map((process) => (
              <li key={process.id}>
                <Link
                  to="/ba-projects/$workspaceId"
                  params={{ workspaceId: process.id }}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-kumo-tint focus-visible:bg-kumo-tint focus-visible:outline-none"
                >
                  <span className="min-w-0 truncate text-[14px] font-medium text-kumo-default">{process.title}</span>
                  <span className="inline-flex shrink-0 items-center gap-2 text-[12px] text-kumo-inactive">
                    {process.owner ? `Shared by ${process.owner.name} · ` : ''}
                    {process.lastActive.toLocaleDateString()}
                    <ArrowRight size={12} aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
