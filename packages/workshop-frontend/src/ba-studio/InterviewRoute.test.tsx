// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInterviewWorkspace } from './interviewWorkspace'
import { Route as InterviewRoute } from '../routes/ba-projects.interview'

const { api } = vi.hoisted(() => ({ api: {} }))

vi.mock('./interviewWorkspace', async (importOriginal) => ({
  ...await importOriginal<typeof import('./interviewWorkspace')>(),
  openInterviewWorkspace: vi.fn<typeof openInterviewWorkspace>(),
}))
vi.mock('../AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
vi.mock('../useWorkspaceOpen', () => ({ useWorkspaceOpen: () => ({ overseer: null, error: null }) }))
vi.mock('../useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../errorReporting', () => ({ reportIssue: () => {} }))
vi.mock('../ChatInterface', () => ({ default: () => null }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
window.scrollTo = () => {}

const resource = 'process://interview/project-1/question_1?token=01234567-89ab-cdef-0123-456789abcdef'

describe('stakeholder invitation navigation', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(async () => {
    await act(async () => root?.unmount())
    container?.remove()
    vi.clearAllMocks()
  })

  const renderAt = async (entry: string) => {
    const rootRoute = createRootRoute({ component: () => <Outlet /> })
    const interview = InterviewRoute.update({
      id: '/ba-projects/interview', path: '/ba-projects/interview', getParentRoute: () => rootRoute,
    } as never)
    const other = createRoute({ getParentRoute: () => rootRoute, path: '/workspaces', component: () => <p>Other page</p> })
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: [entry] }),
      routeTree: rootRoute.addChildren([interview, other]),
    })
    await router.load()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(<RouterProvider router={router} />))
    return router
  }

  it('recovers from a malformed invitation when a valid fragment arrives on the same surface', async () => {
    vi.mocked(openInterviewWorkspace).mockResolvedValue('interview-workspace')
    const router = await renderAt('/ba-projects/interview#%')
    expect(container?.querySelector('[role="alert"]')).not.toBeNull()
    expect(openInterviewWorkspace).not.toHaveBeenCalled()
    await act(async () => { await router.navigate({ to: '/ba-projects/interview', hash: encodeURIComponent(resource) }) })
    expect(openInterviewWorkspace).toHaveBeenCalledWith(expect.anything(), resource)
    expect(router.state.location.search).toEqual({ workspace: 'interview-workspace' })
    expect(router.state.location.hash).toBe('')
    expect(container?.querySelector('[role="alert"]')).toBeNull()
    expect(container?.textContent).toContain('Your conversation with the analyst')
  })

  it('shows an expired invitation failure without retaining or echoing its bearer', async () => {
    vi.mocked(openInterviewWorkspace).mockRejectedValue(new Error('Question closed'))
    await renderAt(`/ba-projects/interview#${encodeURIComponent(resource)}`)
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain("couldn't be opened")
    expect(container?.textContent).not.toContain('01234567')
  })

  it('does not redirect a person back after they leave while an interview is opening', async () => {
    let release!: (id: string) => void
    vi.mocked(openInterviewWorkspace).mockReturnValue(new Promise<string>((resolve) => { release = resolve }))
    const router = await renderAt(`/ba-projects/interview#${encodeURIComponent(resource)}`)
    await act(async () => { await router.navigate({ to: '/workspaces' }) })
    await act(async () => { release('late-workspace') })
    expect(router.state.location.pathname).toBe('/workspaces')
    expect(container?.textContent).toContain('Other page')
  })
})
