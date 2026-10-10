import { describe, expect, it } from 'vitest'
import { interviewResourceFrom } from './interviewWorkspace'

const resource = 'process://interview/project-1/question_1?token=01234567-89ab-cdef-0123-456789abcdef'

describe('question-only interview invitations', () => {
  it('keeps the bearer capability in the fragment and decodes it without broadening its scope', () => {
    expect(interviewResourceFrom(`#${encodeURIComponent(resource)}`)).toBe(resource)
  })

  it.each([
    '#%', '#https://example.com', '#process://project/project-1', '#process://interview/project-1/question_1',
    `#${encodeURIComponent(resource + '&extra=true')}`,
    `#${encodeURIComponent(resource + '#other')}`,
    `#${encodeURIComponent(resource.replace('interview/', 'person@interview/'))}`,
    `#${encodeURIComponent(resource.replace('interview/', 'interview:8080/'))}`,
    `#${encodeURIComponent(resource.replace('process://', 'process://user:password@'))}`,
  ])('rejects malformed or non-interview invitations without echoing the token', (fragment) => {
    expect(() => interviewResourceFrom(fragment)).toThrow(/invitation/)
  })
});
