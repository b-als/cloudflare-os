/** Longest project name derived from an opening; long enough to recognise, short enough for a header. */
export const MAX_DERIVED_NAME_LENGTH = 60

const FALLBACK_NAME = 'Untitled process'
const STORAGE_PREFIX = 'ba-opening:'

const MIN_CLAUSE_LENGTH = 15

/**
 * Names a new project from the person's opening words: their first clause, trimmed to fit. People
 * open with a run-on description ("when X happens, support does Y, then…"), and its first clause is
 * what the process is about; clauses too short to stand alone ("So,") are joined to the next.
 */
export function processNameFrom(opening: string): string {
  const firstSentence = opening.trim().split(/(?<=[.!?])\s|\n/)[0] ?? ''
  const clauses = firstSentence.split(/(?<=[,;:–—])\s/)
  let name = clauses.shift() ?? ''
  while (name.replace(/[,;:–—\s]+$/, '').length < MIN_CLAUSE_LENGTH && clauses.length) {
    name += ` ${clauses.shift()}`
  }
  const cleaned = name.replace(/\s+/g, ' ').replace(/[.!?:;,–—\s]+$/, '').trim()
  if (!cleaned) return FALLBACK_NAME
  const capitalised = cleaned[0].toUpperCase() + cleaned.slice(1)
  if (capitalised.length <= MAX_DERIVED_NAME_LENGTH) return capitalised
  const cut = capitalised.slice(0, MAX_DERIVED_NAME_LENGTH - 1)
  const wordBoundary = cut.lastIndexOf(' ')
  return `${(wordBoundary > MAX_DERIVED_NAME_LENGTH / 2 ? cut.slice(0, wordBoundary) : cut).trimEnd()}…`
}

/**
 * The first message of a project's conversation. The person's own words, framed so the agent
 * treats them as a process to map rather than something to build.
 */
export function openingMessage(opening: string): string {
  return `Help me map this process: ${opening.trim()}`
}

/**
 * Leaves the person's opening words for the new session to send. They travel through session
 * storage, keyed by workspace. The session reads them without consuming them (React may run an
 * initializer twice) and forgets them once the composer has taken them, so a reload after that
 * never re-sends them.
 */
export function rememberOpening(workspaceId: string, opening: string): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + workspaceId, opening)
  } catch {
    // Storage can be unavailable (privacy modes); the session then simply starts without a seed.
  }
}

/** The opening waiting for this workspace, if any. */
export function readOpening(workspaceId: string): string | null {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + workspaceId)
  } catch {
    return null
  }
}

/** Drops the opening once the session's composer has taken it. */
export function forgetOpening(workspaceId: string): void {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + workspaceId)
  } catch {
    // Nothing was stored.
  }
}
