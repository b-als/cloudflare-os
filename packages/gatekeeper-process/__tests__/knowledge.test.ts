import { describe, expect, it } from "vitest";
import { applyKnowledgeOps } from "../src/knowledge.js";
import type { KnowledgeRecord, ProcessGraph } from "../src/types.js";

const graph: ProcessGraph = {
  revision: 0, lanes: [{ id: "lane", label: "Finance" }],
  nodes: [{ id: "approve", laneId: "lane", label: "Approve", type: "userTask", x: 0, y: 0 }], edges: [],
};
const stakeholder: KnowledgeRecord = { id: "pat", nodeIds: [], evidenceIds: [], kind: "stakeholder", name: "Pat", role: "Finance", interests: "", decisionAuthority: "" };

describe("connected analytical knowledge", () => {
  it("allows forward references in a coherent batch without mutating its input", () => {
    const before = { revision: 0, records: [] };
    const after = applyKnowledgeOps(before, [
      { op: "put", record: { id: "owner", kind: "responsibility", nodeIds: ["approve"], evidenceIds: [], stakeholderId: "pat", duty: "accountable" } },
      { op: "put", record: stakeholder },
    ], graph);
    expect(after.records).toHaveLength(2);
    expect(after.revision).toBe(1);
    expect(before.records).toEqual([]);
  });

  it("does not invent or permit duplicate accountability, dangling references or verified assumptions", () => {
    const owner: KnowledgeRecord = { id: "owner", kind: "responsibility", nodeIds: ["approve"], evidenceIds: [], stakeholderId: "pat", duty: "accountable" };
    const knowledge = { revision: 1, records: [stakeholder, owner] };
    expect(() => applyKnowledgeOps(knowledge, [{ op: "put", record: { ...owner, id: "other" } }], graph)).toThrow("accountable");
    expect(() => applyKnowledgeOps(knowledge, [{ op: "remove", id: "pat" }], graph)).toThrow("Unknown stakeholder");
    expect(() => applyKnowledgeOps(knowledge, [], { ...graph, nodes: [] })).toThrow("Unknown linked step");
    expect(() => applyKnowledgeOps(knowledge, [{ op: "put", record: {
      id: "guess", kind: "evidence", nodeIds: [], evidenceIds: [], statement: "Guess", source: "Analyst inference", basis: "assumption", status: "verified",
    } }], graph)).toThrow("assumption");
  });

  it("requires alternatives and a rationale for a resolved trade-off", () => {
    const record: KnowledgeRecord = { id: "choice", kind: "tradeoff", nodeIds: [], evidenceIds: [], question: "Which approval policy?",
      options: [{ id: "all", description: "All", benefits: "Control", costs: "Delay" }, { id: "threshold", description: "Threshold", benefits: "Speed", costs: "Risk" }],
      selectedOptionId: "threshold" };
    expect(() => applyKnowledgeOps({ revision: 0, records: [] }, [{ op: "put", record }], graph)).toThrow("Record text");
  });
});
