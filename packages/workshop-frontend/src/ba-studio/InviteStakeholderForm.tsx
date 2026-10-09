import { useState } from 'react'
import { Copy, Link, UserPlus } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { StakeholderInput, StakeholderStance } from '@gadgets/gatekeeper-process/types'
import type { AiChatAuthorInfo, Overseer } from '@gadgets/workshop-shared/api'
import { copyToClipboard } from '../clipboard'

const STANCES: StakeholderStance[] = ['champion', 'supporter', 'neutral', 'sceptic']

export type InviteStakeholderFormProps = {
  overseer: RpcStub<Overseer>
  /** Absolute URL collaborators should open (BA project path). */
  projectUrl: string
  onUpsertStakeholder: (input: StakeholderInput) => Promise<void> | void
  /** Called after a successful invite + register link. */
  onInvited?: (profile: AiChatAuthorInfo) => void
}

/**
 * Invites a workspace collaborator by username/email and links them on the interview register
 * in one step. Also offers a copyable project link and a share-link mint for people without accounts.
 */
export const InviteStakeholderForm = ({
  overseer,
  projectUrl,
  onUpsertStakeholder,
  onInvited,
}: InviteStakeholderFormProps) => {
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('')
  const [stance, setStance] = useState<StakeholderStance>('neutral')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastInvited, setLastInvited] = useState<string | null>(null)
  const [shareLinkUrl, setShareLinkUrl] = useState<string | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)
  const [copied, setCopied] = useState<'project' | 'share' | null>(null)

  const invite = async () => {
    const trimmedUser = username.trim()
    const trimmedRole = role.trim()
    if (!trimmedUser || !trimmedRole || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await overseer.addCollaborator(trimmedUser, 'build')
      if (result === null) {
        setError('No account found for that username or email.')
        return
      }
      await onUpsertStakeholder({
        name: result.profile.name,
        role: trimmedRole,
        stance,
        userId: result.profile.id,
      })
      setLastInvited(result.profile.name)
      setUsername('')
      onInvited?.(result.profile)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const mintShareLink = async () => {
    if (linkBusy) return
    setLinkBusy(true)
    setError(null)
    try {
      const note = role.trim() ? `BA workshop · ${role.trim()}` : 'BA workshop invite'
      const { key } = await overseer.createShareLink('build', note)
      // Preserve query/path; append the share secret as a fragment (same as ShareModal).
      const base = projectUrl.includes('#') ? projectUrl.split('#')[0]! : projectUrl
      setShareLinkUrl(`${base}#share=${key}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLinkBusy(false)
    }
  }

  const copy = async (kind: 'project' | 'share', url: string) => {
    if (await copyToClipboard(url)) setCopied(kind)
    else setError('Could not copy to clipboard.')
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-dashed border-kumo-line px-2.5 py-2">
      <p className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-kumo-inactive">
        <UserPlus size={12} />
        Invite to workshop
      </p>
      <p className="text-[12px] text-kumo-subtle">
        Add someone as a collaborator and put them on the interview register. They open the same
        project link; assigned questions show as “for you” when they arrive.
      </p>
      <input
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        placeholder="Username or email"
        autoComplete="off"
        className="h-8 rounded-lg border border-kumo-line bg-kumo-base px-2.5 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand"
      />
      <div className="flex gap-2">
        <input
          value={role}
          onChange={(event) => setRole(event.target.value)}
          placeholder="Their role (e.g. Ops lead)"
          className="h-8 min-w-0 flex-1 rounded-lg border border-kumo-line bg-kumo-base px-2.5 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand"
        />
        <select
          value={stance}
          onChange={(event) => setStance(event.target.value as StakeholderStance)}
          className="h-8 w-[120px] rounded-lg border border-kumo-line bg-kumo-base px-2 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand"
        >
          {STANCES.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </div>
      <button
        type="button"
        disabled={!username.trim() || !role.trim() || busy}
        onClick={() => void invite()}
        className="h-8 rounded-lg bg-kumo-brand px-2.5 text-[12.5px] font-medium text-white hover:bg-kumo-brand-hover disabled:opacity-60"
      >
        {busy ? 'Inviting…' : 'Invite & add to register'}
      </button>
      {lastInvited && (
        <p className="text-[12px] text-kumo-subtle">
          Invited <span className="font-medium text-kumo-default">{lastInvited}</span>. Send them the
          project link below.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copy('project', projectUrl)}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-kumo-line px-2 text-[11.5px] font-medium text-kumo-default hover:bg-kumo-tint"
        >
          <Copy size={12} />
          {copied === 'project' ? 'Copied project link' : 'Copy project link'}
        </button>
        <button
          type="button"
          disabled={linkBusy}
          onClick={() => void mintShareLink()}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-kumo-line px-2 text-[11.5px] font-medium text-kumo-default hover:bg-kumo-tint disabled:opacity-60"
        >
          <Link size={12} />
          {linkBusy ? 'Creating…' : 'Create share link'}
        </button>
      </div>
      {shareLinkUrl && (
        <div className="rounded-lg border border-kumo-line bg-kumo-tint/40 px-2.5 py-2">
          <p className="truncate font-mono text-[11px] text-kumo-subtle" title={shareLinkUrl}>
            {shareLinkUrl}
          </p>
          <button
            type="button"
            onClick={() => void copy('share', shareLinkUrl)}
            className="mt-1 text-[11.5px] font-medium text-kumo-brand hover:underline"
          >
            {copied === 'share' ? 'Copied' : 'Copy share link'}
          </button>
        </div>
      )}
      {error && <p className="text-[12px] text-kumo-danger">{error}</p>}
    </div>
  )
}
