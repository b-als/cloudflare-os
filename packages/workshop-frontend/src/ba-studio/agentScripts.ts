import type { StageId } from './prototype'

/**
 * A turn in a scripted BA agent conversation. `message` turns are chat text; `propose`, `ask` and
 * `flag` turns are structured agent actions the human confirms or rejects. The plumbing phase
 * replaces these scripts with the live agent, which emits the same three action kinds.
 */
export type AgentTurn =
  | { kind: 'message'; from: 'agent' | 'user'; text: string }
  | { kind: 'propose' | 'ask' | 'flag'; title: string; detail: string; method?: string }

export const AGENT_SCRIPTS: Record<StageId, AgentTurn[]> = {
  outcomes: [
    { kind: 'message', from: 'agent', text: "Before we look at the process, let's agree what success looks like. What should be different for customers and the bank when this is done?" },
    { kind: 'message', from: 'user', text: 'Onboarding should be faster and less painful.' },
    {
      kind: 'flag',
      title: '"Faster and less painful" is not measurable yet',
      detail: 'A SMART outcome needs a baseline, a target and a date. CRM timestamps show a 12-day median today. What target would the sponsor sign up to?',
      method: 'SMART',
    },
    { kind: 'message', from: 'user', text: 'Three days, by end of Q2.' },
    {
      kind: 'propose',
      title: 'Outcome O-1 with measures M-1 and M-2',
      detail: '"Cut median time from application to usable account from 12 to 3 working days by end of Q2", measured by cycle time and first-time-right rate.',
      method: 'BABOK Strategy Analysis',
    },
    {
      kind: 'flag',
      title: 'O-3 has no deadline',
      detail: 'Abandonment and cost outcomes are specific and measurable but not time-bound. Should they share the Q2 date?',
      method: 'SMART',
    },
  ],
  stakeholders: [
    { kind: 'message', from: 'agent', text: "I've placed everyone from discovery on the power/interest grid. Elena (KYC) has high power and is neutral, so she needs to co-own the decision rules." },
    {
      kind: 'propose',
      title: 'Add a Data Protection Officer',
      detail: 'Automated screening processes beneficial-owner personal data. A DPIA is likely required and nobody in the map owns it.',
      method: 'Stakeholder gap analysis',
    },
    { kind: 'message', from: 'user', text: 'Good catch — add them. Who else is missing?' },
    {
      kind: 'propose',
      title: 'Add the Customer Service Team Lead',
      detail: 'Customers stuck on upload will call support. They were mentioned in two interviews but have no voice in the project.',
      method: 'Stakeholder gap analysis',
    },
    {
      kind: 'ask',
      title: 'Who is accountable for the welcome call?',
      detail: 'RACI needs exactly one "A" per activity. Marcus is responsible; should Priya or the RM team lead be accountable?',
      method: 'RACI',
    },
  ],
  'as-is': [
    { kind: 'message', from: 'agent', text: "Let's scope with SIPOC before drawing anything, so we agree where the process starts and ends." },
    {
      kind: 'propose',
      title: 'Process boundary: "application received" → "account opened"',
      detail: 'Lending decisions and periodic reviews stay out of scope, matching the outcome framing.',
      method: 'SIPOC',
    },
    { kind: 'message', from: 'user', text: 'Agreed. Most of the delay is chasing documents.' },
    {
      kind: 'flag',
      title: 'Rework loop costs ~£142k a year',
      detail: '62% of packs are incomplete, with 2.3 chase cycles adding 4.1 days on average. This is the single largest contributor to M-1.',
      method: 'Lean waste (rework)',
    },
    {
      kind: 'ask',
      title: 'Is EDD-depth review applied to every file?',
      detail: 'The audit sample suggests low-risk files get the same review as high-risk ones. Can Elena confirm?',
      method: 'Elicitation · interview',
    },
  ],
  requirements: [
    { kind: 'message', from: 'agent', text: "Now let's turn pain points into requirements. For P-2 (the chase loop): what should happen the moment a customer uploads a document?" },
    { kind: 'message', from: 'user', text: 'It should be checked straight away, and the customer told if something is wrong.' },
    {
      kind: 'propose',
      title: 'R-02 Automated document & registry verification',
      detail: 'Must-have, owned by Aisha, traced to O-1 and O-2. Fit criterion: ≥ 80% of packs verified with no human touch.',
      method: 'BABOK Elicitation · MoSCoW',
    },
    {
      kind: 'flag',
      title: 'R-08 has no outcome link',
      detail: 'Every requirement should advance an outcome. Link the welcome call to O-3, or downgrade it.',
      method: 'Traceability',
    },
    {
      kind: 'ask',
      title: 'Is the dashboard needed for launch?',
      detail: 'R-09 does not advance any outcome directly and would add ~6 weeks. I suggest "won\'t (this release)".',
      method: 'MoSCoW',
    },
  ],
  'to-be': [
    { kind: 'message', from: 'agent', text: "I've drafted the future state in BPMN. The key design choice is the risk gateway — I've expressed it as a DMN decision table so Compliance can own the rules." },
    {
      kind: 'propose',
      title: 'DT-01 risk tiering (hit policy FIRST)',
      detail: 'Confirmed match → High; potential match → Medium; complex ownership or high-risk industry → Medium; otherwise Low.',
      method: 'DMN 1.4',
    },
    {
      kind: 'flag',
      title: 'Exception path missing for unreadable documents',
      detail: 'The happy path assumes every document verifies. I added a timer event to nudge the customer after 48h.',
      method: 'BPMN exception handling',
    },
    { kind: 'message', from: 'user', text: 'What SLA should medium-risk reviews have?' },
    {
      kind: 'propose',
      title: '24h SLA for medium risk, 72h for EDD',
      detail: 'Keeps the projected median under the 3-day target while leaving Compliance time for high-risk files.',
      method: 'Outcome check (M-1)',
    },
  ],
  tradeoffs: [
    { kind: 'message', from: 'agent', text: "Three options remain. I've scored each against our outcomes, not just cost and effort." },
    {
      kind: 'propose',
      title: 'Prefer OPT-C (hybrid)',
      detail: 'Highest combined impact: +2 on speed and +2 on audit quality. OPT-B is faster to deliver but Compliance cannot see its rules.',
      method: 'Weighted options analysis',
    },
    {
      kind: 'flag',
      title: 'C-02 is still open',
      detail: 'RMs want first contact with every applicant. The sponsor needs to decide before sign-off; the welcome call (D-03) is the proposed compromise.',
      method: 'Conflict register',
    },
    { kind: 'message', from: 'user', text: 'Log the hybrid decision.' },
    {
      kind: 'propose',
      title: 'Decision D-02 logged with rationale',
      detail: '"Best combined impact on speed and audit quality; keeps the process model and rules in our control." Owner: Priya.',
      method: 'Decision log',
    },
  ],
  validate: [
    { kind: 'message', from: 'agent', text: "Let's walk through the future state with real cases. Try a medium-risk application and I'll record each step." },
    {
      kind: 'flag',
      title: 'Abandonment projection misses target',
      detail: 'Projected 17% vs target 15%. Saving progress and a clearer document checklist would likely close the gap.',
      method: 'Outcome projection',
    },
    {
      kind: 'flag',
      title: 'No assisted-digital route',
      detail: 'Customers without a smartphone or scanner cannot complete document upload.',
      method: 'Walkthrough',
    },
    { kind: 'message', from: 'user', text: 'Add an assisted route via branch or phone as a gap.' },
    { kind: 'propose', title: 'Log gap F-1 for the next iteration', detail: 'It will be carried into the baseline as a known gap with an owner.', method: 'Validation' },
  ],
  signoff: [
    { kind: 'message', from: 'agent', text: 'Baseline 1.0 is ready. It includes 5 changes since 0.2 and two open items.' },
    {
      kind: 'flag',
      title: 'Two conditional approvals',
      detail: 'Compliance needs DMN change control; Architecture needs vendor due diligence. Both are logged as conditions on the baseline.',
      method: 'Baseline & change control',
    },
    {
      kind: 'ask',
      title: 'Close C-02 before baselining?',
      detail: 'The sponsor approved subject to C-02 closing. I can hold the baseline until then, or baseline now with C-02 as a known open item.',
      method: 'Change control',
    },
    { kind: 'message', from: 'user', text: 'Hold it until Priya decides on C-02.' },
  ],
  handoff: [
    { kind: 'message', from: 'agent', text: 'The design is ready to leave the whiteboard. I can export it in standard formats or build it on this platform.' },
    {
      kind: 'propose',
      title: 'Build the Compliance review workbench as a gadget',
      detail: 'Covers t-review and t-edd, carries the tier rationale from DT-01, and enforces the 24h / 72h SLAs.',
      method: 'Build',
    },
    {
      kind: 'propose',
      title: 'Schedule the incomplete-application reminders',
      detail: 'A scheduled task implements t-reminder exactly as modelled: 48h, 5 days, close at 14 days.',
      method: 'Build',
    },
    { kind: 'message', from: 'user', text: 'Export BPMN for the architects too.' },
  ],
  monitor: [
    { kind: 'message', from: 'agent', text: 'Six weeks into the pilot. Cycle time is 3.1 days against a target of 3.' },
    {
      kind: 'flag',
      title: 'Abandonment is still above target',
      detail: '18% vs 15%. This matches validation finding F-2 — the assisted route (F-1) is not live yet.',
      method: 'Benefits realisation',
    },
    {
      kind: 'propose',
      title: 'Open a change request for save-and-resume',
      detail: 'Traced to O-3 / M-4. It would start a small new iteration from the Requirements stage.',
      method: 'Continuous improvement',
    },
  ],
}
