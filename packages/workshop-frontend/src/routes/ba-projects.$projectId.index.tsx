import { createFileRoute, redirect } from '@tanstack/react-router'

/** `/ba-projects/$projectId` opens the project at its first stage. */
export const Route = createFileRoute('/ba-projects/$projectId/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/ba-projects/$projectId/$stage',
      params: { projectId: params.projectId, stage: 'outcomes' },
    })
  },
})
