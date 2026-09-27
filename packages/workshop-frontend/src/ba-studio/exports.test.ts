import { describe, expect, it } from 'vitest'
import { DEMO_PROJECT } from './demoProject'
import { toBpmnXml, toUserStoriesMarkdown } from './exports'

describe('BA Studio export generators', () => {
  it('exports BPMN XML with all nodes, flows and escaped text', () => {
    const xml = toBpmnXml(DEMO_PROJECT)
    for (const node of DEMO_PROJECT.toBe.nodes) expect(xml).toContain(`id="${node.id}"`)
    for (const edge of DEMO_PROJECT.toBe.edges) expect(xml).toContain(`sequenceFlow id="${edge.id}"`)
    expect(xml).toContain('Business customer onboarding &amp; KYC')
    expect(xml).not.toContain('Business customer onboarding & KYC')
  })

  it('exports every in-scope requirement as a user story', () => {
    const markdown = toUserStoriesMarkdown(DEMO_PROJECT)
    const included = DEMO_PROJECT.bundle.requirements.requirements.filter((requirement) => requirement.priority !== 'wont')
    const excluded = DEMO_PROJECT.bundle.requirements.requirements.filter((requirement) => requirement.priority === 'wont')
    for (const requirement of included) expect(markdown).toContain(`## ${requirement.id}: ${requirement.title}`)
    for (const requirement of excluded) expect(markdown).not.toContain(`## ${requirement.id}:`)
  })
})
