import type { OpenQuestion, Stakeholder } from '@gadgets/gatekeeper-process/types'

/** Open questions assigned to this workspace user (by userId or linked stakeholder). */
export function questionsForUser(
  openQuestions: OpenQuestion[],
  stakeholders: Stakeholder[],
  userId: string | null | undefined,
): OpenQuestion[] {
  if (!userId) return []
  return openQuestions.filter((question) => {
    if (question.assigneeUserId === userId) return true
    return stakeholders.some(
      (person) =>
        person.stakeholderId === question.assigneeStakeholderId && person.userId === userId,
    )
  })
}

/** Register entry linked to this workspace user, if any. */
export function stakeholderForUser(
  stakeholders: Stakeholder[],
  userId: string | null | undefined,
): Stakeholder | undefined {
  if (!userId) return undefined
  return stakeholders.find((person) => person.userId === userId)
}

/** Whether this user is the current interview target. */
export function isCurrentInterviewTarget(
  stakeholders: Stakeholder[],
  interviewTargetStakeholderId: string | null,
  userId: string | null | undefined,
): boolean {
  if (!userId || !interviewTargetStakeholderId) return false
  return stakeholders.some(
    (person) =>
      person.stakeholderId === interviewTargetStakeholderId && person.userId === userId,
  )
}

/** Unanswered-ask counts keyed by stakeholderId (and by userId for unlinked assignees). */
export function unansweredAsksByPerson(
  openQuestions: OpenQuestion[],
  stakeholders: Stakeholder[],
): { stakeholderId?: string; userId?: string; name: string; count: number }[] {
  const byKey = new Map<string, { stakeholderId?: string; userId?: string; name: string; count: number }>()

  for (const person of stakeholders) {
    byKey.set(`s:${person.stakeholderId}`, {
      stakeholderId: person.stakeholderId,
      userId: person.userId,
      name: person.name,
      count: 0,
    })
  }

  for (const question of openQuestions) {
    if (question.assigneeStakeholderId) {
      const key = `s:${question.assigneeStakeholderId}`
      const existing = byKey.get(key)
      if (existing) {
        existing.count += 1
      } else {
        byKey.set(key, {
          stakeholderId: question.assigneeStakeholderId,
          name: question.assigneeStakeholderId,
          count: 1,
        })
      }
      continue
    }
    if (question.assigneeUserId) {
      const linked = stakeholders.find((person) => person.userId === question.assigneeUserId)
      if (linked) {
        const entry = byKey.get(`s:${linked.stakeholderId}`)
        if (entry) entry.count += 1
        continue
      }
      const key = `u:${question.assigneeUserId}`
      const existing = byKey.get(key)
      if (existing) {
        existing.count += 1
      } else {
        byKey.set(key, {
          userId: question.assigneeUserId,
          name: question.assigneeUserId,
          count: 1,
        })
      }
    }
  }

  return [...byKey.values()]
    .filter((row) => row.count > 0)
    .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}
