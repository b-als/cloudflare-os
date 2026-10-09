// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { AiChatAuthorInfo, Overseer } from '@gadgets/workshop-shared/api'
import type { StakeholderInput } from '@gadgets/gatekeeper-process/types'
import { InviteStakeholderForm } from './InviteStakeholderForm'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
testGlobal.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActEnvironment === undefined) delete testGlobal.IS_REACT_ACT_ENVIRONMENT
  else testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

const copyToClipboard = vi.fn<(text: string) => Promise<boolean>>(async () => true)
vi.mock('../clipboard', () => ({ copyToClipboard: (text: string) => copyToClipboard(text) }))

function fakeOverseer(): RpcStub<Overseer> {
  return {
    addCollaborator: vi.fn<
      (username: string) => Promise<{
        profile: { type: 'user'; id: string; name: string }
        role: 'build'
        edges: []
      } | null>
    >(async (username) => {
      if (username !== 'ada') return null
      return {
        profile: { type: 'user' as const, id: 'u-ada', name: 'Ada' },
        role: 'build' as const,
        edges: [],
      }
    }),
    createShareLink: vi.fn<() => Promise<{ key: string; linkId: string }>>(
      async () => ({ key: 'secret-key', linkId: 'link-1' }),
    ),
  } as unknown as RpcStub<Overseer>
}

describe('InviteStakeholderForm', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = undefined
    container = undefined
    copyToClipboard.mockClear()
  })

  async function renderForm(overseer = fakeOverseer()) {
    const onUpsertStakeholder = vi.fn<(input: StakeholderInput) => Promise<void>>(async () => {})
    const onInvited = vi.fn<(profile: AiChatAuthorInfo) => void>()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <InviteStakeholderForm
          overseer={overseer}
          projectUrl="http://localhost/ba-projects/ws1"
          onUpsertStakeholder={onUpsertStakeholder}
          onInvited={onInvited}
        />,
      )
    })
    return { container: container!, onUpsertStakeholder, onInvited, overseer }
  }

  it('invites a collaborator and upserts the register in one step', async () => {
    const { container: rendered, onUpsertStakeholder, onInvited, overseer } = await renderForm()
    const inputs = [...rendered.querySelectorAll('input')]
    const username = inputs.find((el) => el.placeholder?.includes('Username'))!
    const role = inputs.find((el) => el.placeholder?.includes('role'))!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(username, 'ada')
      username.dispatchEvent(new Event('input', { bubbles: true }))
      setValue.call(role, 'Ops lead')
      role.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const inviteButton = [...rendered.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('Invite & add to register'),
    )!
    await act(async () => {
      inviteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(overseer.addCollaborator).toHaveBeenCalledWith('ada', 'build')
    expect(onUpsertStakeholder).toHaveBeenCalledWith({
      name: 'Ada',
      role: 'Ops lead',
      stance: 'neutral',
      userId: 'u-ada',
    })
    expect(onInvited).toHaveBeenCalledWith({ type: 'user', id: 'u-ada', name: 'Ada' })
    expect(rendered.textContent).toContain('Invited')
    expect(rendered.textContent).toContain('Ada')
  })

  it('mints a BA project share link', async () => {
    const { container: rendered, overseer } = await renderForm()
    const linkButton = [...rendered.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('Create share link'),
    )!
    await act(async () => {
      linkButton.click()
      await Promise.resolve()
    })
    expect(overseer.createShareLink).toHaveBeenCalledWith('build', 'BA workshop invite')
    expect(rendered.textContent).toContain('http://localhost/ba-projects/ws1#share=secret-key')
  })
})
