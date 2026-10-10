import { useMemo, useState } from 'react'
import { Tooltip } from '@cloudflare/kumo'
import { BellRinging, BracketsCurly, DownloadSimple, FlowArrow, Robot, SquaresFour } from '@phosphor-icons/react'
import { Card, DemoDataBadge, Pill } from '../ui'
import { useProject } from '../ProjectContext'
import { toAutomationSpec, toBpmnXml, toUserStoriesMarkdown } from '../exports'
import type { BuildTarget } from '../prototype'
import StageFrame from './StageFrame'

type ExportKind = 'bpmn' | 'stories' | 'automation'

const exportMeta: Record<ExportKind, { label: string; filename: string; mime: string }> = {
  bpmn: { label: 'BPMN 2.0 XML', filename: 'ba-studio-process.bpmn', mime: 'application/xml' },
  stories: { label: 'User stories Markdown', filename: 'ba-studio-user-stories.md', mime: 'text/markdown' },
  automation: { label: 'Automation spec JSON', filename: 'ba-studio-automation-spec.json', mime: 'application/json' },
}

function targetIcon(kind: BuildTarget['kind']) {
  if (kind === 'gadget') return <SquaresFour size={16} />
  if (kind === 'scheduled') return <BellRinging size={16} />
  return <Robot size={16} />
}

function downloadClientFile(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Exports the demo baseline and sketches build targets for the platform phase. */
export default function HandoffStage() {
  const { project, trace, persistence } = useProject()
  const [selected, setSelected] = useState<ExportKind>('bpmn')
  const exports = useMemo(
    () => ({ bpmn: toBpmnXml(project), stories: toUserStoriesMarkdown(project), automation: toAutomationSpec(project) }),
    [project],
  )
  const preview = exports[selected].split('\n').slice(0, 40).join('\n')
  const meta = exportMeta[selected]

  return (
    <StageFrame stage="handoff" actions={<DemoDataBadge />}>
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card
          title="Export baseline artifacts"
          eyebrow="Real client-side downloads"
          actions={
            <button
              type="button"
              onClick={() => downloadClientFile(meta.filename, meta.mime, exports[selected])}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-kumo-brand px-3 text-[12px] font-medium text-white"
            >
              <DownloadSimple size={13} /> Download
            </button>
          }
        >
          <div className="grid gap-2 md:grid-cols-3">
            {(['bpmn', 'stories', 'automation'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setSelected(kind)}
                className={`rounded-lg border p-3 text-left text-[12px] ${selected === kind ? 'border-kumo-brand bg-kumo-brand/10 text-kumo-default' : 'border-kumo-line bg-kumo-elevated text-kumo-subtle'}`}
              >
                <span className="font-semibold">{exportMeta[kind].label}</span>
                <span className="mt-1 block text-[11px] text-kumo-inactive">{exportMeta[kind].filename}</span>
              </button>
            ))}
          </div>
          <pre className="mt-3 max-h-[520px] overflow-auto rounded-lg bg-kumo-tint p-3 text-[11px] leading-5 text-kumo-default">
            {preview}
          </pre>
        </Card>

        <Card title="Build on this platform" eyebrow="Candidate implementation surfaces">
          <div className="space-y-3">
            {project.buildTargets.map((target) => (
              <article key={target.id} className="rounded-lg border border-kumo-line bg-kumo-elevated p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-kumo-default">
                      {targetIcon(target.kind)}
                      <h4 className="text-[13px] font-semibold">{target.title}</h4>
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-kumo-subtle">{target.description}</p>
                  </div>
                  <Pill tone={target.fit === 'recommended' ? 'success' : 'warning'}>{target.fit}</Pill>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {target.coversNodeIds.map((id) => (
                    <button key={id} type="button" onClick={() => trace({ type: 'node', id })} className="inline-flex items-center gap-1 rounded-md bg-kumo-tint px-2 py-1 text-[11px] text-kumo-brand hover:underline">
                      <FlowArrow size={12} /> {id}
                    </button>
                  ))}
                </div>
                {persistence === 'demo' && (
                  <Tooltip content="Wired up in the plumbing phase" asChild>
                    <span className="mt-3 inline-flex">
                      <button type="button" disabled className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-lg border border-kumo-line px-3 text-[12px] text-kumo-inactive">
                        <BracketsCurly size={13} /> Build this · Wired up in the plumbing phase
                      </button>
                    </span>
                  </Tooltip>
                )}
              </article>
            ))}
          </div>
        </Card>
      </div>
    </StageFrame>
  )
}
