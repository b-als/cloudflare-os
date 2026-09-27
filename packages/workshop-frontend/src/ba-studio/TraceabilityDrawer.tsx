import type { ReactNode } from 'react'
import { ArrowDown, TreeStructure, X } from '@phosphor-icons/react'
import type { TraceFocus } from './ProjectContext'
import type { BaPrototypeProject } from './prototype'
import { traceChain } from './trace'
import { formatMeasure, Pill, priorityLabel, priorityTone } from './ui'

function Level({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-kumo-inactive">
        {label}
        <span className="rounded bg-kumo-tint px-1 text-[10px] font-medium text-kumo-subtle">{count}</span>
      </p>
      {count === 0 ? (
        <p className="rounded-lg border border-dashed border-kumo-danger/50 bg-kumo-danger-tint px-2.5 py-2 text-[12px] text-kumo-danger">
          Nothing traced here — a gap the agent will flag.
        </p>
      ) : (
        <div className="space-y-1.5">{children}</div>
      )}
    </div>
  )
}

function Item({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`block w-full rounded-lg border px-2.5 py-2 text-left text-[12px] leading-[16px] transition-colors ${
        active ? 'border-kumo-brand bg-kumo-brand/10' : 'border-kumo-line bg-kumo-base hover:bg-kumo-tint'
      } disabled:cursor-default`}
    >
      {children}
    </button>
  )
}

const Arrow = () => (
  <div className="flex justify-center text-kumo-inactive">
    <ArrowDown size={14} />
  </div>
)

/** Side drawer showing the outcome → measure → requirement → step → decision chain. */
export default function TraceabilityDrawer({
  project,
  focus,
  onFocus,
  onClose,
}: {
  project: BaPrototypeProject
  focus: TraceFocus
  onFocus: (focus: TraceFocus) => void
  onClose: () => void
}) {
  const chain = traceChain(project, focus)
  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-[360px] max-w-full flex-col border-l border-kumo-line bg-kumo-elevated shadow-2xl">
      <header className="flex items-center justify-between gap-2 border-b border-kumo-line px-4 py-3">
        <div className="flex items-center gap-2">
          <TreeStructure size={16} className="text-kumo-brand" />
          <p className="text-[13px] font-semibold text-kumo-default">Traceability</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-kumo-subtle hover:bg-kumo-tint"
          title="Close"
        >
          <X size={14} />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
        <Level label="Outcomes" count={chain.outcomes.length}>
          {chain.outcomes.map((o) => (
            <Item key={o.id} active={focus.type === 'outcome' && focus.id === o.id} onClick={() => onFocus({ type: 'outcome', id: o.id })}>
              <span className="font-semibold text-kumo-default">{o.id}</span> <span className="text-kumo-default">{o.title}</span>
            </Item>
          ))}
        </Level>
        <Arrow />
        <Level label="Measures" count={chain.measures.length}>
          {chain.measures.map((m) => (
            <Item key={m.id}>
              <span className="font-semibold text-kumo-default">{m.id}</span> <span className="text-kumo-default">{m.name}</span>
              <span className="block text-[11px] text-kumo-subtle">
                {formatMeasure(m.baseline, m)} → {formatMeasure(m.target, m)}
              </span>
            </Item>
          ))}
        </Level>
        <Arrow />
        <Level label="Requirements" count={chain.requirements.length}>
          {chain.requirements.map((r) => (
            <Item
              key={r.id}
              active={focus.type === 'requirement' && focus.id === r.id}
              onClick={() => onFocus({ type: 'requirement', id: r.id })}
            >
              <span className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-semibold text-kumo-default">{r.id}</span> <span className="text-kumo-default">{r.title}</span>
                </span>
                <Pill tone={priorityTone[r.priority]}>{priorityLabel[r.priority]}</Pill>
              </span>
            </Item>
          ))}
        </Level>
        <Arrow />
        <Level label="Process steps (future state)" count={chain.nodes.length}>
          {chain.nodes.map((n) => (
            <Item key={n.id} active={focus.type === 'node' && focus.id === n.id} onClick={() => onFocus({ type: 'node', id: n.id })}>
              <span className="text-kumo-default">{n.label}</span>
              <span className="block text-[11px] text-kumo-subtle">
                {n.type}
                {n.slaHours !== undefined ? ` · SLA ${n.slaHours}h` : ''}
              </span>
            </Item>
          ))}
        </Level>
        <Arrow />
        <Level label="Decisions" count={chain.decisions.length + chain.decisionTables.length}>
          {chain.decisionTables.map((t) => (
            <Item key={t.id}>
              <span className="font-semibold text-kumo-default">{t.id}</span> <span className="text-kumo-default">{t.name}</span>
              <span className="block text-[11px] text-kumo-subtle">DMN · {t.rules.length} rules · hit policy {t.hitPolicy}</span>
            </Item>
          ))}
          {chain.decisions.map((d) => (
            <Item key={d.id}>
              <span className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-semibold text-kumo-default">{d.id}</span> <span className="text-kumo-default">{d.summary}</span>
                </span>
                <Pill tone={d.status === 'approved' ? 'success' : 'warning'}>{d.status}</Pill>
              </span>
            </Item>
          ))}
        </Level>
      </div>
    </div>
  )
}
