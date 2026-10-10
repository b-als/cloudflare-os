import type { ProcessGraph, ProcessNode } from '@gadgets/gatekeeper-process/types'
import type { PendingPreview } from '@gadgets/gatekeeper-process/ui-types'

export type BriefSection = 'Purpose' | 'People' | 'Decisions' | 'Risks' | 'Open work' | 'Evidence'
export type BriefEntry = {
  id: string
  section: BriefSection
  title: string
  summary: string
  status: 'Agreed' | 'Proposed' | 'Open' | 'Reported' | 'Disputed'
  nodeIds: string[]
  details: { label: string; value: string }[]
  source: string
  evidenceId?: string
}

/** Review priorities and relationships are explicit design fixtures, not inferred business judgements. */
export const SAMPLE_REVIEW_TOPICS = [
  {
    id: 'cover', title: 'Resolve approver cover', summary: 'Blocks validation of the approval exception.',
    recordIds: ['approval-question', 'cover-risk', 'control', 'approval-evidence'],
  },
  {
    id: 'mismatches', title: 'Reduce repeated supplier chasing', summary: 'Understand the actual cases before proposing automation.',
    recordIds: ['examples-question', 'match-risk'],
  },
  {
    id: 'baseline', title: 'Measure the payment outcome', summary: 'Establish the baseline before judging improvement.',
    recordIds: ['baseline-question'],
  },
]

/** Local person assignment is a design fixture, not a new field in the project API. */
export type SampleStep = ProcessNode & { assignedPersonId?: string }
export type SampleGraph = Omit<ProcessGraph, 'nodes'> & { nodes: SampleStep[] }

/** Presentation fixtures describe the proposed experience, not a future RPC schema. */
export const SAMPLE_GRAPH: SampleGraph = {
  revision: 7,
  lanes: [
    { id: 'operations', label: 'Operations' },
    { id: 'finance', label: 'Finance' },
  ],
  nodes: [
    { id: 'receive', type: 'startEvent', laneId: 'operations', label: 'Invoice received', x: 160, y: 44 },
    { id: 'match', type: 'userTask', laneId: 'operations', label: 'Match invoice to order', owner: 'Accounts payable', system: 'ERP', x: 250, y: 30 },
    { id: 'check', type: 'exclusiveGateway', laneId: 'operations', label: 'Order matches?', x: 450, y: 40 },
    { id: 'resolve', type: 'userTask', laneId: 'operations', label: 'Resolve mismatch', owner: 'Procurement', assignedPersonId: 'jo', x: 540, y: 30, painPoints: 'Supplier corrections are chased manually.' },
    { id: 'approve', type: 'userTask', laneId: 'finance', label: 'Approve invoice', owner: 'Budget owner', assignedPersonId: 'alex', x: 450, y: 170, duration: { amount: 2, unit: 'days' }, painPoints: 'Escalation ownership is disputed.' },
    { id: 'pay', type: 'serviceTask', laneId: 'finance', label: 'Schedule payment', system: 'ERP', owner: 'Finance', x: 670, y: 170 },
    { id: 'paid', type: 'endEvent', laneId: 'finance', label: 'Supplier paid', x: 880, y: 183 },
  ],
  edges: [
    { id: 'receive-match', source: 'receive', target: 'match' },
    { id: 'match-check', source: 'match', target: 'check' },
    { id: 'check-resolve', source: 'check', target: 'resolve', label: 'No' },
    { id: 'resolve-match', source: 'resolve', target: 'match', label: 'Corrected' },
    { id: 'check-approve', source: 'check', target: 'approve', label: 'Yes' },
    { id: 'approve-pay', source: 'approve', target: 'pay' },
    { id: 'pay-paid', source: 'pay', target: 'paid' },
  ],
}

export const SAMPLE_PREVIEW: PendingPreview = {
  addedLanes: [], addedNodes: [], addedEdges: [], removedNodeIds: [], removedEdgeIds: [],
  changedNodeIds: ['approve'], changedEdgeIds: [],
}

export const SAMPLE_ENTRIES: BriefEntry[] = [
  {
    id: 'outcome', section: 'Purpose', title: 'Pay suppliers on time, without weakening controls',
    summary: 'Target: 95% paid within terms. Current baseline: not established.', status: 'Agreed',
    nodeIds: [],
    details: [
      { label: 'Measure', value: 'Percentage of supplier invoices paid within agreed payment terms.' },
      { label: 'Baseline', value: 'Not established. A sample of ERP payment timestamps is needed.' },
      { label: 'Scope', value: 'From receipt of a supplier invoice to payment. Supplier onboarding is outside this investigation.' },
    ],
    source: 'Sample opening conversation with the process owner',
  },
  {
    id: 'maya', section: 'People', title: 'Maya Patel', summary: 'Process owner · Finance lead', status: 'Agreed',
    nodeIds: ['approve', 'pay', 'paid'],
    details: [
      { label: 'Accountability', value: 'Owns this investigation and the supplier payment process.' },
      { label: 'Decision remit', value: 'Approval policy and residual financial risk, subject to delegated limits.' },
      { label: 'Engagement', value: 'Review alternatives after operational accounts have been reconciled.' },
    ],
    source: 'Sample project brief',
  },
  {
    id: 'jo', section: 'People', title: 'Jo Morgan', summary: 'Procurement · consulted on exceptions', status: 'Agreed',
    nodeIds: ['match', 'resolve'],
    details: [
      { label: 'Responsibility', value: 'Investigates order mismatches and coordinates supplier corrections.' },
      { label: 'Interests', value: 'Fewer repeat chases and clearer escalation ownership.' },
      { label: 'Outstanding request', value: 'Provide three recent examples of mismatched invoices.' },
    ],
    source: 'Sample procurement interview',
  },
  {
    id: 'alex', section: 'People', title: 'Alex Chen', summary: 'Budget owner · approval responsibility', status: 'Reported',
    nodeIds: ['approve'],
    details: [
      { label: 'Responsibility', value: 'Checks the invoice against the department budget.' },
      { label: 'Uncertainty', value: 'Who acts when the budget owner is unavailable has not been agreed.' },
      { label: 'Engagement', value: 'Clarification requested; sample response deadline is 14 October.' },
    ],
    source: 'Sample operational interview', evidenceId: 'approval-evidence',
  },
  {
    id: 'control', section: 'Decisions', title: 'Keep invoice approval separate from payment',
    summary: 'Maya to decide · independent payment check', status: 'Proposed', nodeIds: ['approve', 'pay'],
    details: [
      { label: 'Option A', value: 'Separate approver and payment operator. Preserves an independent check; requires cover arrangements.' },
      { label: 'Option B', value: 'One person approves and pays. Faster hand-off, but increases the risk of an unchecked payment.' },
      { label: 'Recommendation', value: 'Option A, with a named backup approver. Backup ownership remains unresolved.' },
      { label: 'Decision-maker', value: 'Maya Patel. This prototype does not verify or grant decision authority.' },
    ],
    source: 'Sample control assessment', evidenceId: 'policy-evidence',
  },
  {
    id: 'scope', section: 'Decisions', title: 'Supplier onboarding stays outside this investigation',
    summary: 'Maya Patel · 10 October · current-state scope', status: 'Agreed', nodeIds: [],
    details: [
      { label: 'Rationale', value: 'Focus first on delays between invoice receipt and payment; onboarding has a separate accountable team.' },
      { label: 'Review trigger', value: 'Revisit if evidence shows onboarding data is a material source of payment delays.' },
    ],
    source: 'Sample scope discussion',
  },
  {
    id: 'cover-risk', section: 'Risks', title: 'Approval stalls when the budget owner is away',
    summary: 'Owner unassigned · late payment exposure', status: 'Open', nodeIds: ['approve'],
    details: [
      { label: 'Impact', value: 'Missed payment terms, supplier complaints and avoidable manual chasing.' },
      { label: 'Likelihood', value: 'Not assessed. The two stakeholder accounts disagree about frequency.' },
      { label: 'Response', value: 'Name a backup approver and agree an escalation threshold.' },
      { label: 'Owner', value: 'Unassigned' },
    ],
    source: 'Sample stakeholder accounts', evidenceId: 'approval-evidence',
  },
  {
    id: 'match-risk', section: 'Risks', title: 'Order mismatches create repeated supplier chases',
    summary: 'Jo Morgan · response not yet agreed', status: 'Open', nodeIds: ['match', 'resolve'],
    details: [
      { label: 'Impact', value: 'Rework and delayed invoice processing.' },
      { label: 'Owner', value: 'Jo Morgan' },
      { label: 'Next action', value: 'Review actual mismatch examples before proposing automation.' },
    ],
    source: 'Sample procurement interview',
  },
  {
    id: 'approval-question', section: 'Open work', title: 'Who covers an absent approver?',
    summary: 'Alex Chen · due 14 October · blocks approval design', status: 'Open', nodeIds: ['approve'],
    details: [
      { label: 'Why it matters', value: 'We cannot validate an exception path without an accountable cover arrangement.' },
      { label: 'Question', value: 'Who takes over, and how long does an invoice wait before escalation?' },
      { label: 'Follow-up', value: 'Sample request awaiting a response. No real invitation has been sent.' },
    ],
    source: 'Sample analyst agenda', evidenceId: 'approval-evidence',
  },
  {
    id: 'examples-question', section: 'Open work', title: 'Check three recent invoice mismatches',
    summary: 'Jo Morgan · due 15 October · evidence needed', status: 'Open', nodeIds: ['match', 'resolve'],
    details: [{ label: 'Request', value: 'Trace receipt, each chase and the corrected order for three recent cases.' }],
    source: 'Sample analyst agenda',
  },
  {
    id: 'baseline-question', section: 'Open work', title: 'Establish the on-time payment baseline',
    summary: 'Maya Patel · unassigned extraction · blocks outcome measurement', status: 'Open', nodeIds: ['pay', 'paid'],
    details: [{ label: 'Evidence needed', value: 'Agreed terms and actual payment dates from a representative ERP sample.' }],
    source: 'Sample analyst agenda',
  },
  {
    id: 'approval-evidence', section: 'Evidence', title: 'Approval delay: two accounts, no verified timing',
    summary: 'Finance says 2 days; Operations says up to 9', status: 'Disputed', nodeIds: ['approve'],
    details: [
      { label: 'Finance account', value: 'Approvals usually take two working days.' },
      { label: 'Operations account', value: 'Invoices can wait nine days when the budget owner is away.' },
      { label: 'Assessment', value: 'Both may describe different cases. Check timestamps and absence scenarios; do not average them or treat either as verified.' },
    ],
    source: 'Two fictional, independent stakeholder interviews',
  },
  {
    id: 'policy-evidence', section: 'Evidence', title: 'Independent payment check',
    summary: 'Sample policy excerpt, not independently verified', status: 'Reported', nodeIds: ['approve', 'pay'],
    details: [{ label: 'Claim', value: 'Payment instructions should receive a check independent of the payment operator.' }],
    source: 'Fictional finance policy used for design review',
  },
]

export const inStepScope = (entry: BriefEntry, stepId: string | null) => !stepId || entry.nodeIds.includes(stepId)

/** Work the analyst still has to close: open questions and risks, undecided proposals and contested evidence. */
export const isOpenItem = (entry: BriefEntry) =>
  entry.status === 'Open' || entry.status === 'Proposed' || entry.status === 'Disputed'

export const countOpenItems = (entries: BriefEntry[]) => {
  const counts: Record<string, number> = {}
  for (const entry of entries.filter(isOpenItem)) {
    for (const id of entry.nodeIds) counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
}
