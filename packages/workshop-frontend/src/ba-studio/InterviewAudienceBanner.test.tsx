// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenQuestion } from '@gadgets/gatekeeper-process/types'
import { InterviewAudienceBanner } from './InterviewAudienceBanner'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
testGlobal.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActEnvironment === undefined) delete testGlobal.IS_REACT_ACT_ENVIRONMENT
  else testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

const question: OpenQuestion = {
  questionId: 'q1',
  text: 'What triggers the process?',
  raisedAt: 1,
  nodeIds: [],
}

describe('InterviewAudienceBanner', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = undefined
    container = undefined
  })

  async function renderBanner(props: {
    beingInterviewed: boolean
    questionsForYou: OpenQuestion[]
    onOpenQuestions: () => void
  }) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<InterviewAudienceBanner {...props} />)
    })
    return container
  }

  it('renders nothing when the user has no interview role', async () => {
    const rendered = await renderBanner({
      beingInterviewed: false,
      questionsForYou: [],
      onOpenQuestions: () => {},
    })
    expect(rendered.textContent).toBe('')
  })

  it('announces interview target and opens questions', async () => {
    const onOpenQuestions = vi.fn()
    const rendered = await renderBanner({
      beingInterviewed: true,
      questionsForYou: [question],
      onOpenQuestions,
    })
    expect(rendered.textContent).toContain("You're being interviewed")
    const button = [...rendered.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('Review questions'),
    )
    expect(button).toBeTruthy()
    await act(async () => {
      button!.click()
    })
    expect(onOpenQuestions).toHaveBeenCalledTimes(1)
  })

  it('shows questions-for-you when not the ask-next target', async () => {
    const rendered = await renderBanner({
      beingInterviewed: false,
      questionsForYou: [question],
      onOpenQuestions: () => {},
    })
    expect(rendered.textContent).toContain('Questions for you')
    expect(rendered.textContent).not.toContain("You're being interviewed")
  })
})
