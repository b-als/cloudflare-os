import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Plus } from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import { useAuthenticatedApi } from '../AuthContext'
import { useDocumentTitle } from '../useDocumentTitle'
import { reportIssue } from '../errorReporting'
import { BA_STUDIO_APP_ID, disposeFrame } from './workflow-studio'
import type { BaProjectSummary, BaUiApi } from '../ba-studio/types'
import type { ProjectSummary } from '../ba-studio/prototype'
import { DEMO_PORTFOLIO } from '../ba-studio/demoProject'
import { STAGES, stageIndex } from '../ba-studio/stages'
import { Card, DemoDataBadge, Pill, type Tone } from '../ba-studio/ui'

/**
 * BA Projects home: the portfolio of BA Studio projects with stage progress, outcome health and
 * open conflicts / sign-offs per project. The portfolio is demo data for the UI prototype; the
 * "Live projects" section below it lists real projects from the BA Studio gatekeeper's
 * `listProjects()` when that gatekeeper is installed, opening them in Workflow Studio.
 */
export const Route = createFileRoute('/ba-projects/')({
  component: BaProjectsPage,
})

const healthTone: Record<ProjectSummary['outcomeHealth'], Tone> = { onTrack: 'success', atRisk: 'warning', offTrack: 'danger' }
const healthLabel: Record<ProjectSummary['outcomeHealth'], string> = { onTrack: 'On track', atRisk: 'At risk', offTrack: 'Off track' }

function StageMiniProgress({ current }: { current: ProjectSummary['currentStage'] }) {
  const reached = stageIndex(current)
  return (
    <div className="flex gap-0.5" title={`Stage ${reached + 1} of ${STAGES.length}: ${STAGES[reached].label}`}>
      {STAGES.map((stage, index) => (
        <span
          key={stage.id}
          className={`h-1.5 w-3 rounded-full ${index < reached ? 'bg-kumo-success' : index === reached ? 'bg-kumo-brand' : 'bg-kumo-tint'}`}
        />
      ))}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: 'warning' | 'success' }) {
  const color = tone === 'warning' ? 'text-kumo-warning' : tone === 'success' ? 'text-kumo-success' : 'text-kumo-default'
  return (
    <div className="rounded-xl border border-kumo-line bg-kumo-base px-4 py-3">
      <p className={`text-[22px] font-semibold ${color}`}>{value}</p>
      <p className="text-[12px] text-kumo-subtle">{label}</p>
    </div>
  )
}

function BaProjectsPage() {
  useDocumentTitle('BA Projects')
  const onTrack = DEMO_PORTFOLIO.filter((p) => p.outcomeHealth === 'onTrack').length
  const conflicts = DEMO_PORTFOLIO.reduce((sum, p) => sum + p.openConflicts, 0)
  const signoffs = DEMO_PORTFOLIO.reduce((sum, p) => sum + p.pendingSignoffs, 0)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 pb-10 pt-10 sm:px-10">
      <header>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">BA Projects</h1>
          <DemoDataBadge />
        </div>
        <p className="mt-1 max-w-2xl text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">
          Agent-led process definition, from outcome to running process. Every requirement, step and trade-off traces back to a
          measurable outcome.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Projects" value={DEMO_PORTFOLIO.length} />
        <Metric label="Outcomes on track" value={`${onTrack}/${DEMO_PORTFOLIO.length}`} tone="success" />
        <Metric label="Open conflicts" value={conflicts} tone={conflicts > 0 ? 'warning' : undefined} />
        <Metric label="Sign-offs pending" value={signoffs} tone={signoffs > 0 ? 'warning' : undefined} />
      </div>

      <Card eyebrow="Portfolio" title="Process projects">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead className="text-[11px] uppercase tracking-wide text-kumo-inactive">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Process</th>
                <th className="py-1.5 pr-3 font-medium">Stage</th>
                <th className="py-1.5 pr-3 font-medium">Outcomes</th>
                <th className="py-1.5 pr-3 text-center font-medium">Conflicts</th>
                <th className="py-1.5 pr-3 text-center font-medium">Sign-offs</th>
                <th className="py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-kumo-line">
              {DEMO_PORTFOLIO.map((project) => (
                <tr key={project.id} className={project.openable ? '' : 'opacity-70'}>
                  <td className="py-2.5 pr-3">
                    <p className="font-medium text-kumo-default">{project.processName}</p>
                    <p className="text-[11.5px] text-kumo-subtle">
                      Sponsor {project.sponsor} · updated {new Date(project.updatedAt).toLocaleDateString()}
                    </p>
                  </td>
                  <td className="py-2.5 pr-3">
                    <StageMiniProgress current={project.currentStage} />
                    <p className="mt-1 text-[11.5px] text-kumo-subtle">{STAGES[stageIndex(project.currentStage)].label}</p>
                  </td>
                  <td className="py-2.5 pr-3">
                    <Pill tone={healthTone[project.outcomeHealth]}>{healthLabel[project.outcomeHealth]}</Pill>
                  </td>
                  <td className="py-2.5 pr-3 text-center text-kumo-default">{project.openConflicts}</td>
                  <td className="py-2.5 pr-3 text-center text-kumo-default">{project.pendingSignoffs}</td>
                  <td className="py-2.5 text-right">
                    {project.openable ? (
                      <Link
                        to="/ba-projects/$projectId/$stage"
                        params={{ projectId: project.id, stage: project.currentStage }}
                        className="inline-flex h-7 items-center gap-1 rounded-lg bg-kumo-brand px-2.5 text-[12px] font-medium text-white hover:bg-kumo-brand-hover"
                      >
                        Open <ArrowRight size={12} />
                      </Link>
                    ) : (
                      <span className="text-[11.5px] text-kumo-inactive">Summary only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <LiveProjectsSection />
    </div>
  )
}

/** Real BA Studio projects from the gatekeeper, opened in Workflow Studio. */
function LiveProjectsSection() {
  const { authenticatedApi } = useAuthenticatedApi()
  const navigate = useNavigate()
  const [frame, setFrame] = useState<GatekeeperUiFrame | null>(null)
  const [projects, setProjects] = useState<BaProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Derive the ui capability fresh from `frame` on every render (mirrors workflow-studio.tsx)
  // rather than storing the extracted stub in its own state slot, which was found to hand out a
  // broken capnweb reference once round-tripped through React state.
  const ui = frame?.ui as RpcStub<BaUiApi> | undefined

  useEffect(() => {
    let cancelled = false
    let acquired: GatekeeperUiFrame | null = null
    // Mirrors workflow-studio.tsx's ambient-account acquisition: the BA Studio gatekeeper
    // auto-provisions on demand, so a fresh account has no app yet until provisioned once.
    authenticatedApi
      .getGatekeeperApp(BA_STUDIO_APP_ID)
      .then(async (existing) => {
        if (existing) return existing
        await authenticatedApi.provisionAmbientAccount(BA_STUDIO_APP_ID)
        return authenticatedApi.getGatekeeperApp(BA_STUDIO_APP_ID)
      })
      .then(async (provisioned) => {
        if (!provisioned) {
          if (!cancelled) setError('BA Studio gatekeeper app is not available on this deployment.')
          return
        }
        if (cancelled) {
          disposeFrame(provisioned)
          return
        }
        acquired = provisioned
        setFrame(provisioned)
        setLoading(true)
        try {
          setProjects(await (provisioned.ui as RpcStub<BaUiApi>).listProjects())
        } catch (err) {
          console.error('Failed to list BA Studio projects:', err)
          reportIssue('ba-projects.list', err, { gatekeeperVendorId: BA_STUDIO_APP_ID })
          setError(`${err}`)
        } finally {
          setLoading(false)
        }
      })
      .catch((err) => {
        console.error('Failed to acquire BA Studio UI capability:', err)
        reportIssue('ba-projects.acquire-ui', err, { gatekeeperVendorId: BA_STUDIO_APP_ID })
        if (!cancelled) setError(`${err}`)
      })
    return () => {
      cancelled = true
      disposeFrame(acquired)
    }
  }, [authenticatedApi])

  const createProject = useCallback(async () => {
    if (!ui) return
    const name = newProjectName.trim() || 'Untitled process'
    setCreating(true)
    setError(null)
    try {
      const record = await ui.createProject(name)
      setNewProjectName('')
      navigate({ to: '/workflow-studio', search: { process: record.processId } })
    } catch (err) {
      console.error('Failed to create BA Studio project:', err)
      reportIssue('ba-projects.create', err, { gatekeeperVendorId: BA_STUDIO_APP_ID })
      setError(`${err}`)
    } finally {
      setCreating(false)
    }
  }, [navigate, newProjectName, ui])

  return (
    <Card
      eyebrow="Live projects"
      title="From the BA Studio gatekeeper"
      actions={
        <>
          <input
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            placeholder="New project name"
            className="h-8 rounded-lg border border-kumo-line bg-kumo-base px-3 text-[12.5px] text-kumo-default"
          />
          <button
            type="button"
            onClick={() => void createProject()}
            disabled={creating || !ui}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-kumo-brand px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-kumo-brand-hover disabled:opacity-60"
          >
            <Plus size={13} weight="bold" />
            {creating ? 'Creating…' : 'New project'}
          </button>
        </>
      }
    >
      {error ? (
        <p className="py-4 text-center text-[12.5px] text-kumo-subtle">
          Live projects are unavailable: {error}
        </p>
      ) : loading ? (
        <p className="py-4 text-center text-[12.5px] text-kumo-subtle">Loading projects…</p>
      ) : projects.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-kumo-subtle">
          No live BA Studio projects yet. Create one to open Workflow Studio and start talking to the BA agent.
        </p>
      ) : (
        <ul className="divide-y divide-kumo-line">
          {projects.map((project) => (
            <li key={project.processId}>
              <button
                type="button"
                onClick={() => navigate({ to: '/workflow-studio', search: { process: project.processId } })}
                className="flex w-full items-center justify-between gap-4 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-kumo-tint"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-kumo-default">{project.processName}</p>
                  <p className="mt-0.5 truncate text-[11.5px] text-kumo-subtle">{project.processId}</p>
                </div>
                <p className="shrink-0 text-[11.5px] text-kumo-inactive">
                  v{project.version} · updated {new Date(project.updatedAt).toLocaleString()}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
