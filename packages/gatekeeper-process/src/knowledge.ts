import type { KnowledgeOp, KnowledgeRecord, ProcessGraph, ProjectKnowledge } from "./types.js";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_RECORDS = 500;
const MAX_TEXT = 4000;

/** An invalid analytical edit or a reference overtaken by another accepted change. */
export class KnowledgeOpError extends Error {}

/** Domain constraints shared by preview and commit. Structural RPC validation is generated. */
export function applyKnowledgeOps(
  before: ProjectKnowledge, ops: KnowledgeOp[], graph: ProcessGraph,
): ProjectKnowledge {
  if (ops.length > 100) throw new KnowledgeOpError("A knowledge change may contain at most 100 edits.");
  const records = new Map(before.records.map((record) => [record.id, record]));
  for (const op of ops) {
    requireId(op.op === "put" ? op.record.id : op.id);
    if (op.op === "remove") {
      if (!records.delete(op.id)) throw new KnowledgeOpError(`Unknown knowledge record ${op.id}.`);
    } else {
      const existing = records.get(op.record.id);
      if (existing && existing.kind !== op.record.kind) throw new KnowledgeOpError("A record cannot change its kind.");
      records.set(op.record.id, op.record);
    }
  }
  if (records.size > MAX_RECORDS) throw new KnowledgeOpError(`A project may contain at most ${MAX_RECORDS} knowledge records.`);
  const nodes = new Set(graph.nodes.map((node) => node.id));
  const accountable = new Map<string, string>();
  const stakeholder = (id: string) => {
    if (records.get(id)?.kind !== "stakeholder") throw new KnowledgeOpError(`Unknown stakeholder ${id}.`);
  };
  for (const record of records.values()) {
    requireId(record.id);
    if (record.nodeIds.length > 100 || record.evidenceIds.length > 100) throw new KnowledgeOpError("Too many record links.");
    if (new Set(record.nodeIds).size !== record.nodeIds.length ||
        new Set(record.evidenceIds).size !== record.evidenceIds.length) throw new KnowledgeOpError("Record links must be unique.");
    for (const id of record.nodeIds) if (!nodes.has(id)) throw new KnowledgeOpError(`Unknown linked step ${id}.`);
    for (const id of record.evidenceIds) {
      if (id === record.id || records.get(id)?.kind !== "evidence") throw new KnowledgeOpError(`Unknown supporting evidence ${id}.`);
    }
    switch (record.kind) {
      case "stakeholder":
        text(record.name); text(record.role); text(record.interests, true); text(record.decisionAuthority, true);
        break;
      case "outcome":
        text(record.description); text(record.measure); optionalText(record.baseline); optionalText(record.target);
        break;
      case "responsibility":
        stakeholder(record.stakeholderId);
        if (!record.nodeIds.length) throw new KnowledgeOpError("A responsibility must name at least one step.");
        if (record.duty === "accountable") {
          for (const id of record.nodeIds) {
            if (accountable.has(id)) throw new KnowledgeOpError(`Step ${id} already has an accountable stakeholder.`);
            accountable.set(id, record.stakeholderId);
          }
        }
        break;
      case "evidence":
        text(record.statement); text(record.source);
        if (record.stakeholderId !== undefined) stakeholder(record.stakeholderId);
        if (record.basis === "assumption" && record.status === "verified") {
          throw new KnowledgeOpError("An assumption cannot be verified evidence; identify its actual source first.");
        }
        break;
      case "risk":
        text(record.description); text(record.impact); text(record.mitigation, true);
        if (record.ownerStakeholderId !== undefined) stakeholder(record.ownerStakeholderId);
        break;
      case "tradeoff":
        text(record.question);
        if (record.options.length < 2 || record.options.length > 10) throw new KnowledgeOpError("A trade-off needs 2-10 alternatives.");
        if (new Set(record.options.map((option) => option.id)).size !== record.options.length) {
          throw new KnowledgeOpError("Trade-off option IDs must be unique.");
        }
        for (const option of record.options) {
          requireId(option.id); text(option.description); text(option.benefits); text(option.costs);
        }
        if (record.selectedOptionId !== undefined) {
          if (!record.options.some((option) => option.id === record.selectedOptionId)) throw new KnowledgeOpError("Unknown chosen alternative.");
          text(record.rationale ?? "");
        } else if (record.rationale !== undefined) {
          throw new KnowledgeOpError("A trade-off rationale requires a chosen alternative.");
        }
        break;
      case "question":
        text(record.text); stakeholder(record.stakeholderId);
        if (record.dueAt !== undefined && (!Number.isSafeInteger(record.dueAt) || record.dueAt <= 0 || record.dueAt > 8_640_000_000_000_000)) {
          throw new KnowledgeOpError("A question deadline must be an absolute epoch-millisecond timestamp.");
        }
        if (record.status === "resolved") text(record.resolution ?? "");
        else if (record.resolution !== undefined) throw new KnowledgeOpError("Only a resolved question has a resolution.");
        break;
    }
  }
  return { revision: before.revision + (ops.length ? 1 : 0), records: [...records.values()] };
}

/** Looks up a question without treating a different record kind as one. */
export function findQuestion(knowledge: ProjectKnowledge, id: string): Extract<KnowledgeRecord, { kind: "question" }> {
  const record = knowledge.records.find((item) => item.id === id);
  if (record?.kind !== "question") throw new KnowledgeOpError(`Unknown investigation question ${id}.`);
  return record;
}

function requireId(id: string): void {
  if (!ID.test(id)) throw new KnowledgeOpError("Record IDs must be 1-64 letters, digits, underscores or hyphens.");
}

function text(value: string, empty = false): void {
  if ((!empty && !value.trim()) || value.length > MAX_TEXT) throw new KnowledgeOpError(`Record text must be ${empty ? "0" : "1"}-${MAX_TEXT} characters.`);
}

function optionalText(value: string | undefined): void {
  if (value !== undefined) text(value);
}
