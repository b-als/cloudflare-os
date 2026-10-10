import { describe, expect, it } from "vitest";
import { projectDocument } from "../src/documents.js";
import type { ProjectContext } from "../src/types.js";

const context: Omit<ProjectContext, "coverage"> = {
  name: "Invoice approval",
  graph: { revision: 3, lanes: [], edges: [], nodes: [
    { id: "approve", label: "Approve invoice", type: "userTask", laneId: "finance", x: 0, y: 0 },
    { id: "pay", label: "Pay supplier", type: "serviceTask", laneId: "finance", x: 0, y: 0 },
  ] },
  knowledge: { revision: 2, records: [
    { id: "pat", kind: "stakeholder", name: "Pat", role: "Finance", interests: "Control", decisionAuthority: "", nodeIds: [], evidenceIds: [] },
    { id: "owner", kind: "responsibility", stakeholderId: "pat", duty: "accountable", nodeIds: ["approve"], evidenceIds: [] },
    { id: "doer", kind: "responsibility", stakeholderId: "pat", duty: "responsible", nodeIds: ["approve"], evidenceIds: [] },
  ] },
  decisions: [], contributions: [], investigation: { enabled: false, pending: 0, failed: [] },
};

describe("documents from accepted analytical knowledge", () => {
  it("renders responsibilities without inventing accountability for an unassigned step", () => {
    expect(projectDocument(context, "responsibilities")).toBe(
      "# Invoice approval\n\nMap revision 3; knowledge revision 2.\n\n" +
      "## Responsibility matrix\n\n" +
      "| Step | Pat | Accountability |\n| --- | --- | --- |\n" +
      "| Approve invoice | A, R | Assigned |\n| Pay supplier | - | Unassigned |\n" +
      "\nR = performs; A = accountable; C = consulted; I = informed. Unassigned responsibilities remain unknown.\n",
    );
  });

  it("shows uncertainty and absent records explicitly rather than synthesising success", () => {
    expect(projectDocument(context, "stakeholders")).toContain("| Pat | Finance | Control | Not established |");
    expect(projectDocument(context, "risks")).toContain("Nothing recorded yet.");
    expect(projectDocument(context, "tradeoffs")).toContain("Nothing recorded yet.");
    expect(projectDocument(context, "brief")).toContain("Outstanding questions");
  });

  it("escapes table and markup delimiters without losing user content", () => {
    const changed = { ...context, knowledge: { ...context.knowledge, records: [
      { ...context.knowledge.records[0], name: "Pat | <script>\nFinance" },
    ] } };
    const output = projectDocument(changed, "stakeholders");
    expect(output).toContain("Pat \\| \\<script\\> Finance");
    expect(output).not.toContain("<script>");
  });

  it("preserves the original question beside testimony and does not infer it for older accounts", () => {
    const reply = {
      id: "account-1", questionId: "q", stakeholderId: "pat", stakeholderName: "Pat", requestId: "first",
      questionText: "What slows approval?", statement: "The queue is nine days.", baselineRevision: 1, submittedAt: 1,
    };
    const { questionText, ...older } = reply;
    expect(projectDocument({ ...context, contributions: [reply] }, "evidence")).toContain(questionText);
    expect(projectDocument({ ...context, contributions: [older] }, "evidence")).toContain("Original question not recorded");
  });
});
