import { ChatCircleDots, ListChecks } from '@phosphor-icons/react'

type Suggestion = {
  id: string
  label: string
  description: string
  prompt: string
}

function suggestions(processName: string): Suggestion[] {
  return [
    {
      id: 'interview',
      label: 'Describe the process to me',
      description: 'I ask what triggers it, who does what, and how it ends',
      prompt:
        `I'd like to map "${processName}". Ask me what triggers it, the roles or systems involved, ` +
        'the main sequence of steps, and how it ends, then draft the first version of the flow for me to review.',
    },
    {
      id: 'outline',
      label: "I'll list the steps myself",
      description: 'Give a rough outline and get a first draft of the map',
      prompt:
        `Here's a rough outline of "${processName}": `,
    },
  ]
}

function SuggestionRow({ icon, label, description, onClick }: {
  icon: React.ReactNode
  label: string
  description: string
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-kumo-tint"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-kumo-fill text-kumo-subtle transition-colors group-hover:text-kumo-default">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium leading-4 text-kumo-default">{label}</span>
          <span className="block truncate text-[11.5px] leading-4 text-kumo-subtle">{description}</span>
        </span>
      </button>
    </li>
  )
}

export type ProcessStarterPromptsProps = {
  processName: string
  onPick: (prompt: string) => void
}

/** Shown once, before anything is mapped: nudges a new project toward the elicitation conversation. */
export default function ProcessStarterPrompts({ processName, onPick }: ProcessStarterPromptsProps) {
  return (
    <section aria-label="Get started" className="flex flex-col gap-1 border-b border-kumo-line px-3 py-2.5">
      <h3 className="px-1 pb-0.5 text-[11px] font-medium uppercase tracking-[0.06em] text-kumo-inactive">
        Get started
      </h3>
      <ul className="flex flex-col gap-0.5">
        {suggestions(processName).map((suggestion) => (
          <SuggestionRow
            key={suggestion.id}
            icon={suggestion.id === 'interview' ? <ChatCircleDots size={15} /> : <ListChecks size={15} />}
            label={suggestion.label}
            description={suggestion.description}
            onClick={() => onPick(suggestion.prompt)}
          />
        ))}
      </ul>
    </section>
  )
}
