import type { BaPrototypeProject, BpmnElementType, ProcessModelNode } from './prototype'

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function bpmnTag(type: BpmnElementType): string {
  if (type === 'timerEvent') return 'intermediateCatchEvent'
  return type
}

function nodeXml(node: ProcessModelNode): string {
  const tag = bpmnTag(node.type)
  if (node.type === 'timerEvent') {
    return `    <${tag} id="${escapeXml(node.id)}" name="${escapeXml(node.label)}">\n      <timerEventDefinition />\n    </${tag}>`
  }
  return `    <${tag} id="${escapeXml(node.id)}" name="${escapeXml(node.label)}" />`
}

export function toBpmnXml(project: BaPrototypeProject): string {
  const model = project.toBe
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  for (const edge of model.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.id])
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.id])
  }

  const lanes = model.lanes.map((lane) => {
    const refs = model.nodes
      .filter((node) => node.laneId === lane.id)
      .map((node) => `        <flowNodeRef>${escapeXml(node.id)}</flowNodeRef>`)
      .join('\n')
    return `      <lane id="${escapeXml(lane.id)}" name="${escapeXml(lane.label)}">\n${refs}\n      </lane>`
  })

  const nodes = model.nodes.map((node) => {
    const body = nodeXml(node)
    const inRefs = (incoming.get(node.id) ?? []).map((id) => `      <incoming>${escapeXml(id)}</incoming>`).join('\n')
    const outRefs = (outgoing.get(node.id) ?? []).map((id) => `      <outgoing>${escapeXml(id)}</outgoing>`).join('\n')
    if (!inRefs && !outRefs) return body
    if (body.endsWith('/>')) {
      const open = body.replace(' />', '>')
      return `${open}\n${[inRefs, outRefs].filter(Boolean).join('\n')}\n    </${bpmnTag(node.type)}>`
    }
    return body.replace(`\n    </${bpmnTag(node.type)}>`, `\n${[inRefs, outRefs].filter(Boolean).join('\n')}\n    </${bpmnTag(node.type)}>`)
  })

  const flows = model.edges.map((edge) => {
    const condition = edge.condition
      ? `\n      <conditionExpression xsi:type="tFormalExpression">${escapeXml(edge.condition)}</conditionExpression>\n    `
      : ''
    if (!edge.condition) return `    <sequenceFlow id="${escapeXml(edge.id)}" sourceRef="${escapeXml(edge.source)}" targetRef="${escapeXml(edge.target)}" />`
    return `    <sequenceFlow id="${escapeXml(edge.id)}" sourceRef="${escapeXml(edge.source)}" targetRef="${escapeXml(edge.target)}">${condition}</sequenceFlow>`
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" targetNamespace="https://gadgets.local/ba-studio">',
    `  <process id="${escapeXml(project.bundle.requirements.processId)}" name="${escapeXml(project.bundle.processName)}" isExecutable="false">`,
    '    <laneSet id="lane-set">',
    lanes.join('\n'),
    '    </laneSet>',
    nodes.join('\n'),
    flows.join('\n'),
    '  </process>',
    '</definitions>',
  ].join('\n')
}

export function toUserStoriesMarkdown(project: BaPrototypeProject): string {
  const outcomes = new Map(project.framing.outcomes.map((outcome) => [outcome.id, outcome.title]))
  return project.bundle.requirements.requirements
    .filter((requirement) => requirement.priority !== 'wont')
    .map((requirement) => {
      const owner = project.bundle.requirements.stakeholders.find((stakeholder) => stakeholder.id === requirement.ownerStakeholderId)
      const traced = (project.requirementOutcomes[requirement.id] ?? []).map((id) => outcomes.get(id) ?? id)
      const criteria = requirement.acceptanceCriteria.map((criterion) => `- ${criterion}`).join('\n')
      return [
        `## ${requirement.id}: ${requirement.title}`,
        '',
        `As a ${owner?.role ?? 'stakeholder'}, I want ${requirement.title} so that ${requirement.benefitHypothesis}`,
        '',
        `MoSCoW: ${requirement.priority}`,
        `Traced outcomes: ${traced.length ? traced.join('; ') : 'None'}`,
        '',
        'Acceptance criteria:',
        criteria,
      ].join('\n')
    })
    .join('\n\n')
}

export function toAutomationSpec(project: BaPrototypeProject): string {
  return JSON.stringify(
    {
      processId: project.bundle.requirements.processId,
      processName: project.bundle.processName,
      processSteps: project.toBe.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        label: node.label,
        slaHours: node.slaHours ?? null,
        requirementIds: node.requirementIds ?? [],
      })),
      sequenceFlows: project.toBe.edges,
      slas: project.toBe.nodes.filter((node) => node.slaHours !== undefined).map((node) => ({ nodeId: node.id, hours: node.slaHours })),
      decisionTables: project.decisionTables,
      buildTargets: project.buildTargets,
    },
    null,
    2,
  )
}
