import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { AiChatAuthorInfo, Overseer } from '@gadgets/workshop-shared/api'

/** The people who can be assigned things in this workspace: its collaborators plus you. */
export function useWorkspacePeople(
  overseer: { stub: RpcStub<Overseer> } | null,
  currentUser: AiChatAuthorInfo | null,
): AiChatAuthorInfo[] {
  const [people, setPeople] = useState<AiChatAuthorInfo[]>([])

  useEffect(() => {
    if (!overseer) {
      setPeople(currentUser ? [currentUser] : [])
      return
    }
    let cancelled = false
    overseer.stub.listCollaborators().then((collaborators) => {
      if (cancelled) return
      const byId = new Map<string, AiChatAuthorInfo>()
      if (currentUser) byId.set(currentUser.id, currentUser)
      for (const collaborator of collaborators) byId.set(collaborator.profile.id, collaborator.profile)
      setPeople([...byId.values()])
    }).catch(() => {
      // Best-effort: fields that suggest people still accept free text if this fails.
    })
    return () => {
      cancelled = true
    }
  }, [overseer, currentUser])

  return people
}
