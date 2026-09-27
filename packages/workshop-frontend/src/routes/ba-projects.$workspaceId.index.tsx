import { createFileRoute } from '@tanstack/react-router'

// The project layout renders the canvas itself; there is no nested screen.
export const Route = createFileRoute('/ba-projects/$workspaceId/')({
  component: () => null,
})
