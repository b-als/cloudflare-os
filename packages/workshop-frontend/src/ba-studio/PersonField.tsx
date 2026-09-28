import { useEffect, useRef, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { AiChatAuthorInfo, AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { PersonAvatar } from '../components/PersonAvatar'

export type PersonFieldProps = {
  label: string
  value: string
  people: AiChatAuthorInfo[]
  authenticatedApi: RpcStub<AuthenticatedApi>
  onCommit: (value: string) => void
  disabled: boolean
  placeholder?: string
}

/** A free-text field (a role or team is fine) that also suggests the workspace's real people. */
export default function PersonField({
  label, value, people, authenticatedApi, onCommit, disabled, placeholder,
}: PersonFieldProps) {
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => setDraft(value), [value])

  const query = draft.trim().toLowerCase()
  const matches = query === '' ? people : people.filter((person) => person.name.toLowerCase().includes(query))

  const commit = (next: string) => {
    setOpen(false)
    if (next !== value) onCommit(next)
  }

  return (
    <label className="relative block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-kumo-inactive">{label}</span>
      <input
        ref={inputRef}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setDraft(event.target.value)
          setOpen(true)
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(value)
            event.currentTarget.blur()
          }
        }}
        className="w-full rounded-lg border border-kumo-line bg-kumo-base px-2.5 py-1.5 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand disabled:opacity-60"
      />
      {open && !disabled && matches.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-lg border border-kumo-line bg-kumo-elevated py-1 shadow-lg">
          {matches.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                // Keeps focus on the input so `onBlur` doesn't fire (and race) before this click.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setDraft(person.name)
                  commit(person.name)
                  inputRef.current?.blur()
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] text-kumo-default hover:bg-kumo-tint"
              >
                <PersonAvatar api={authenticatedApi} userId={person.id} name={person.name} size={18} />
                {person.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  )
}
