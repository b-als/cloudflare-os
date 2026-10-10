import type { KnowledgeRecord, ProjectContext, ProjectDocumentKind } from "./types.js";

/** Documents are read models of accepted state: exporting cannot create or change project facts. */
export function projectDocument(context: Omit<ProjectContext, "coverage">, kind: ProjectDocumentKind): string {
  const records = context.knowledge.records;
  const step = (ids: string[]) => ids.map((id) => context.graph.nodes.find((node) => node.id === id)?.label ?? id).join(", ") || "Whole process";
  const person = (id: string | undefined) => {
    const record = records.find((item) => item.id === id);
    return record?.kind === "stakeholder" ? record.name : "Unassigned";
  };
  const source = (record: KnowledgeRecord) => record.evidenceIds.join(", ") || "No linked evidence";
  const title = `# ${context.name}\n\nMap revision ${context.graph.revision}; knowledge revision ${context.knowledge.revision}.\n\n`;
  switch (kind) {
    case "brief": {
      const outcomes = records.filter((record) => record.kind === "outcome");
      const questions = records.filter((record) => record.kind === "question").filter((record) => record.status === "open");
      return title + "## Outcomes\n\n" + table(["Outcome", "Measure", "Baseline", "Target"],
        outcomes.map((record) => [record.description, record.measure, record.baseline ?? "Not established", record.target ?? "Not agreed"])) +
        "\n## Outstanding questions\n\n" + table(["Question", "Assigned to", "Due"],
          questions.map((record) => [record.text, person(record.stakeholderId), record.dueAt ? new Date(record.dueAt).toISOString() : "No deadline"])) +
        "\n## Accepted decisions\n\n" + table(["Decision", "Rationale"], context.decisions.map((decision) => [decision.summary, decision.rationale]));
    }
    case "stakeholders":
      return title + table(["Stakeholder", "Role", "Interests", "Decision authority"],
        records.filter((record) => record.kind === "stakeholder").map((record) =>
          [record.name, record.role, record.interests || "Not established", record.decisionAuthority || "Not established"]));
    case "responsibilities": {
      const stakeholders = records.filter((record) => record.kind === "stakeholder");
      const duties = { responsible: "R", accountable: "A", consulted: "C", informed: "I" };
      const responsibilities = records.filter((record) => record.kind === "responsibility");
      return title + "## Responsibility matrix\n\n" + table(["Step", ...stakeholders.map((record) => record.name), "Accountability"],
        context.graph.nodes.map((node) => [
          node.label,
          ...stakeholders.map((record) => [...new Set(responsibilities
            .filter((item) => item.stakeholderId === record.id && item.nodeIds.includes(node.id))
            .map((item) => duties[item.duty]))].join(", ") || "-"),
          responsibilities.some((record) => record.duty === "accountable" && record.nodeIds.includes(node.id)) ? "Assigned" : "Unassigned",
        ])) + "\nR = performs; A = accountable; C = consulted; I = informed. Unassigned responsibilities remain unknown.\n";
    }
    case "risks":
      return title + table(["Risk", "Affected steps", "Impact", "Owner", "Mitigation", "Status", "Evidence"],
        records.filter((record) => record.kind === "risk").map((record) =>
          [record.description, step(record.nodeIds), record.impact, person(record.ownerStakeholderId), record.mitigation || "Not agreed", record.status, source(record)]));
    case "tradeoffs": {
      const tradeoffs = records.filter((record) => record.kind === "tradeoff");
      return title + (tradeoffs.length ? tradeoffs.map((record) =>
        `## ${inline(record.question)}\n\n` +
        table(["Alternative", "Benefits", "Costs"], record.options.map((option) => [option.description, option.benefits, option.costs])) +
        `\nChoice: ${inline(record.options.find((option) => option.id === record.selectedOptionId)?.description ?? "Not decided")}.\n\n` +
        `Rationale: ${inline(record.rationale ?? "Not decided")}.\n\nEvidence: ${inline(source(record))}.\n`).join("\n") : "Nothing recorded yet.\n");
    }
    case "evidence":
      return title + table(["Evidence ID", "Statement", "Source", "Basis", "Status", "Affected steps"],
        records.filter((record) => record.kind === "evidence").map((record) =>
          [record.id, record.statement, record.source, record.basis, record.status, step(record.nodeIds)])) +
        "\n## Stakeholder accounts (unverified testimony)\n\n" + table(["Account ID", "Assigned interview", "Original question", "Account", "Map baseline"],
          context.contributions.map((reply) => [
            reply.id, reply.stakeholderName, reply.questionText ?? "Original question not recorded", reply.statement, String(reply.baselineRevision),
          ]));
  }
}

function inline(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[|`*_[\]<>#]/g, "\\$&").replace(/\r?\n/g, " ");
}

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return "Nothing recorded yet.\n";
  return [headers.map(inline).join(" | "), headers.map(() => "---").join(" | "),
    ...rows.map((row) => row.map(inline).join(" | "))].map((line) => `| ${line} |`).join("\n") + "\n";
}
