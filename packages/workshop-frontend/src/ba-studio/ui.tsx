import type { ReactNode } from 'react'
import { Database } from '@phosphor-icons/react'
import { Tooltip } from '@cloudflare/kumo'
import { useProject } from './ProjectContext'
import type { BaPrototypeProject, Measure } from './prototype'

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet'

const toneClass: Record<Tone, string> = {
  neutral: 'bg-kumo-tint text-kumo-subtle',
  brand: 'bg-kumo-brand/15 text-kumo-brand',
  success: 'bg-kumo-success-tint text-kumo-success',
  warning: 'bg-kumo-warning-tint text-kumo-warning',
  danger: 'bg-kumo-danger-tint text-kumo-danger',
  info: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
}

export function Pill({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ${toneClass[tone]}`}
    >
      {children}
    </span>
  )
}

export function Card({
  title,
  eyebrow,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-kumo-line bg-kumo-base p-4 ${className}`}>
      {(title || actions || eyebrow) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && <p className="text-[11px] font-medium uppercase tracking-wide text-kumo-inactive">{eyebrow}</p>}
            {title && <h3 className="text-[14px] font-semibold text-kumo-default">{title}</h3>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

/** Marks a surface as backed by demo data rather than the live BA Studio gatekeeper. */
export function DemoDataBadge({ label = 'Demo data' }: { label?: string }) {
  const { persistence } = useProject()
  if (persistence === 'live') return null
  return (
    <Tooltip content="This screen shows a worked example. It is not connected to a live BA Studio project yet." asChild>
      <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-kumo-warning/60 bg-kumo-warning-tint px-1.5 py-0.5 text-[11px] font-medium text-kumo-warning">
        <Database size={12} />
        {label}
      </span>
    </Tooltip>
  )
}

export function stakeholderName(project: BaPrototypeProject, id: string | undefined): string {
  if (!id) return 'Unassigned'
  return project.bundle.requirements.stakeholders.find((s) => s.id === id)?.name ?? id
}

export function formatMeasure(value: number, measure: Measure): string {
  if (measure.unit === '%') return `${value}%`
  if (measure.unit.startsWith('£')) return `£${value}`
  return `${value} ${measure.unit}`
}

export function formatGbp(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(value)
}

/** Fraction (0–1) of the way from baseline to target that `value` represents. */
export function measureProgress(measure: Measure, value: number): number {
  const span = measure.target - measure.baseline
  if (span === 0) return 1
  return Math.max(0, Math.min(1, (value - measure.baseline) / span))
}

export function meetsTarget(measure: Measure, value: number): boolean {
  return measure.direction === 'decrease' ? value <= measure.target : value >= measure.target
}

export function ProgressBar({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'success' | 'warning' }) {
  const color = tone === 'success' ? 'bg-kumo-success' : tone === 'warning' ? 'bg-kumo-warning' : 'bg-kumo-brand'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-kumo-tint">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

export const priorityTone = { must: 'danger', should: 'warning', could: 'info', wont: 'neutral' } as const satisfies Record<string, Tone>
export const priorityLabel = { must: 'Must', should: 'Should', could: 'Could', wont: "Won't" } as const
