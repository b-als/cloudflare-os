import { ChatCircleDots, ListChecks } from '@phosphor-icons/react'

type StarterOption = {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  prompt: string
}

function options(processName: string): StarterOption[] {
  return [
    {
      id: 'interview',
      label: 'Start interview',
      description: 'I identify who to interview, then ask what triggers it and how it ends',
      icon: <ChatCircleDots size={16} />,
      prompt:
        `I'd like to map "${processName}". Start by identifying the people/roles to interview ` +
        '(upsertStakeholder + setInterviewTarget for who to ask next), then ask what triggers it, ' +
        'the main sequence, exceptions, and how it ends. Raise assigned open questions when someone ' +
        'else must answer. When answers contradict, someone does not know, or scope drifts, ' +
        'raiseQuestion / retarget — do not invent owners or branches, and do not expand the graph ' +
        'until scope and placement are clear. Draft the first flow only once placement is clear; ' +
        'follow getContext().coverage and interviewPlan.',
    },
    {
      id: 'outline',
      label: 'Outline the steps myself',
      description: "I'll dictate a rough sequence and get a first draft",
      icon: <ListChecks size={16} />,
      prompt:
        `I'd like to map "${processName}" from a rough outline I'll give you. ` +
        "Ask me to list the steps in order, who's involved (record them with upsertStakeholder), " +
        'and how it ends, then draft the flow. Use coverage and interviewPlan from getContext() to ' +
        'spot gaps. raiseQuestion with an assignee when a named person must confirm something, ' +
        'including contradictions, unknowns, or whether a tangent is in scope — do not invent ' +
        'missing facts or map adjacent processes until I confirm they belong here.',
    },
  ]
}

export type ProcessStarterPromptsProps = {
  processName: string
  /** Called with the prompt to send immediately, kicking off the elicitation conversation. */
  onStart: (prompt: string) => void
}

/**
 * Shown once, before any conversation has started: the chat composer stays locked until one of
 * these is picked, since a blank composer with no direction invites a blank-page stall.
 */
export default function ProcessStarterPrompts({ processName, onStart }: ProcessStarterPromptsProps) {
  return (
    <section aria-label="Get started" className="flex flex-col gap-2 border-b border-kumo-line px-3 py-3">
      <p className="px-0.5 text-[12px] leading-4 text-kumo-subtle">
        Nothing's mapped yet. Pick how you'd like to start — the agent takes it from there.
      </p>
      <div className="flex flex-col gap-1.5">
        {options(processName).map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onStart(
              option.prompt + ' Work with this workspace\'s PROCESS_PROJECT binding and its persistent BA lifecycle; do not create a separate prototype project.',
            )}
            className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-kumo-line bg-kumo-base px-2.5 py-2 text-left transition-colors hover:border-kumo-brand hover:bg-kumo-brand/5"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-kumo-brand/15 text-kumo-brand">
              {option.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium leading-4 text-kumo-default">
                {option.label}
              </span>
              <span className="block truncate text-[11.5px] leading-4 text-kumo-subtle">{option.description}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
