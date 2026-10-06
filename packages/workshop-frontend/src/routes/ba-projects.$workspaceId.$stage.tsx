import { createFileRoute } from '@tanstack/react-router'

/** The parent renders the live stage against its single project subscription and chat session. */
export const Route = createFileRoute('/ba-projects/$workspaceId/$stage')({
  component: () => null,
})
