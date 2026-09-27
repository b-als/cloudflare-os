import { Card, DemoDataBadge, formatMeasure, meetsTarget, Pill } from '../ui'
import { useProject } from '../ProjectContext'
import type { Measure, MonitoringSeries } from '../prototype'
import StageFrame from './StageFrame'

function latest(series: MonitoringSeries | undefined): number | undefined {
  return series?.points.at(-1)?.actual
}

function chartPath(values: number[], min: number, max: number): string {
  if (values.length === 0) return ''
  const span = max - min || 1
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 92 : 8 + (index * 84) / (values.length - 1)
      const y = 58 - ((value - min) / span) * 48
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

function MeasureChart({ measure, series }: { measure: Measure; series: MonitoringSeries | undefined }) {
  const values = series?.points.map((point) => point.actual) ?? []
  const all = [...values, measure.baseline, measure.target]
  const min = Math.min(...all)
  const max = Math.max(...all)
  const yFor = (value: number) => 58 - ((value - min) / (max - min || 1)) * 48
  return (
    <svg viewBox="0 0 100 64" role="img" aria-label={`${measure.name} trend`} className="h-20 w-full text-kumo-brand">
      <line x1="6" x2="96" y1={yFor(measure.baseline)} y2={yFor(measure.baseline)} stroke="currentColor" strokeDasharray="3 3" opacity="0.35" />
      <line x1="6" x2="96" y1={yFor(measure.target)} y2={yFor(measure.target)} stroke="currentColor" strokeDasharray="5 3" opacity="0.65" />
      <path d={chartPath(values, min, max)} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {values.map((value, index) => {
        const x = values.length === 1 ? 92 : 8 + (index * 84) / (values.length - 1)
        return <circle key={`${value}-${index}`} cx={x} cy={yFor(value)} r="2" fill="currentColor" />
      })}
    </svg>
  )
}

/** Future benefits-realisation monitor for live measures after go-live. */
export default function MonitorStage() {
  const { project, trace } = useProject()
  const seriesByMeasure = new Map(project.monitoring.map((series) => [series.measureId, series]))

  return (
    <StageFrame stage="monitor" actions={<DemoDataBadge label="Future stage" />}>
      <Card title="Benefits realisation" eyebrow="Future stage">
        <p className="text-[13px] leading-6 text-kumo-subtle">
          This future screen shows how the agreed outcomes would be monitored after launch. Demo series stand in for operational telemetry.
        </p>
      </Card>

      <div className="space-y-4">
        {project.framing.outcomes.map((outcome) => {
          const measures = project.framing.measures.filter((measure) => measure.outcomeId === outcome.id)
          const met = measures.filter((measure) => {
            const actual = latest(seriesByMeasure.get(measure.id))
            return actual !== undefined && meetsTarget(measure, actual)
          }).length
          const health = met === measures.length ? 'on track' : met > 0 ? 'at risk' : 'off track'
          return (
            <Card
              key={outcome.id}
              title={
                <button type="button" onClick={() => trace({ type: 'outcome', id: outcome.id })} className="text-left text-kumo-brand hover:underline">
                  {outcome.title}
                </button>
              }
              eyebrow="Outcome health"
              actions={<Pill tone={health === 'on track' ? 'success' : health === 'at risk' ? 'warning' : 'danger'}>{health} · {met}/{measures.length}</Pill>}
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {measures.map((measure) => {
                  const series = seriesByMeasure.get(measure.id)
                  const actual = latest(series)
                  const targetMet = actual !== undefined && meetsTarget(measure, actual)
                  return (
                    <article key={measure.id} className="rounded-lg border border-kumo-line bg-kumo-elevated p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-[13px] font-semibold text-kumo-default">{measure.name}</h4>
                          <p className="text-[11px] text-kumo-inactive">{measure.source} · {measure.cadence}</p>
                        </div>
                        <Pill tone={targetMet ? 'success' : 'warning'}>{targetMet ? 'meets target' : 'watch'}</Pill>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                        <div><p className="text-kumo-inactive">Baseline</p><p className="font-semibold text-kumo-default">{formatMeasure(measure.baseline, measure)}</p></div>
                        <div><p className="text-kumo-inactive">Target</p><p className="font-semibold text-kumo-default">{formatMeasure(measure.target, measure)}</p></div>
                        <div><p className="text-kumo-inactive">Latest</p><p className="font-semibold text-kumo-default">{actual === undefined ? '—' : formatMeasure(actual, measure)}</p></div>
                      </div>
                      <div className="mt-3 text-kumo-brand">
                        <MeasureChart measure={measure} series={series} />
                      </div>
                    </article>
                  )
                })}
              </div>
            </Card>
          )
        })}
      </div>
    </StageFrame>
  )
}
