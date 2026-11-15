import { format } from "date-fns";
import { askJson, assistantName } from "@/lib/ai";
import { TERRAINS, VERDICTS, type Analysis, type Dossier } from "./store";

/**
 * The AI side of Decisions: a demanding sparring partner, not a cheerleader. It builds a tree of
 * branches with explicit, arguable probabilities, projects them at 1, 5 and 10 years, attacks the
 * favourite option, names the biases at play — and learns from how past decisions turned out.
 */

const SYSTEM = `You are a strategic sparring partner for one person facing a hard decision — professional, financial or personal. Help them see several moves ahead and decide better; don't reassure them.

- Brief: restate the real question in one sharp paragraph — what's truly at stake, and the deadline if there is one.
- Branches: 3 to 5. Always include the status quo, and at least one serious option they didn't list.
- For each branch, an explicit probability of success (0–100) and what success means, so the number can be argued with. When their track record is given, correct for it: if past outcomes contradicted predictions, adjust.
- Project each branch at 1 year, 5 years and 10 years — the immediate consequence is never the whole story.
- Reversibility 0–100 (a one-way door deserves a slow decision, a two-way door a fast one), and concrete, measurable stop criteria: the signals that should make them abandon the branch.
- Red team: three distinct adversaries (e.g. a sceptical investor, the person most affected, their future self) each attacking the option they seem to favour.
- Biases: the ones visibly at work in how they framed it (sunk costs, over-optimism, confirmation, anchoring…), with the evidence from their words and a correction.
- Recommend one branch with your confidence; say so when it's close.

Write in the language the person used. Be specific to their situation; no generic advice.`;

const str = { type: "string" };
const int = (description: string) => ({ type: "integer", description });
const closed = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const list = (items: Record<string, unknown>) => ({ type: "array", items });

const SCHEMA = closed({
  brief: str,
  branches: list(
    closed({
      name: str,
      description: str,
      status_quo: { type: "boolean" },
      unseen: { type: "boolean", description: "True for an option the person had not listed" },
      probability: int("Chance of success, 0-100"),
      success: { ...str, description: "What success means for this branch" },
      year_1: str,
      year_5: str,
      year_10: str,
      reversibility: int("0 = one-way door, 100 = fully reversible"),
      stop_criteria: list(str),
    }),
  ),
  red_team: list(closed({ adversary: str, attack: str })),
  biases: list(closed({ name: str, evidence: str, correction: str })),
  recommendation: closed({ branch: { ...str, description: "The name of one branch" }, why: str, confidence: int("0-100") }),
});

type Raw = {
  brief: string;
  branches: { name: string; description: string; status_quo: boolean; unseen: boolean; probability: number; success: string; year_1: string; year_5: string; year_10: string; reversibility: number; stop_criteria: string[] }[];
  red_team: Analysis["redTeam"];
  biases: Analysis["biases"];
  recommendation: Analysis["recommendation"];
};

/** Past decisions next to what really happened, so probabilities can be recalibrated. */
function trackRecord(all: Dossier[], except: string) {
  return all
    .filter((d) => d.id !== except && d.decision && d.outcome)
    .slice(0, 12)
    .map((d) => {
      const chosen = d.analysis?.branches.find((b) => b.name === d.decision!.branch);
      return `- "${d.title}": chose "${d.decision!.branch}"${chosen ? ` (predicted ${chosen.probability}%)` : ""}, ${d.decision!.confidence}% confident → ${VERDICTS[d.outcome!.verdict].label.toLowerCase()}${d.outcome!.note ? `: ${d.outcome!.note}` : ""}`;
    })
    .join("\n");
}

/** Builds the decision tree for a dossier. */
export async function analyzeDossier(d: Dossier, all: Dossier[]): Promise<Analysis> {
  const record = trackRecord(all, d.id);
  const options = d.options.filter((o) => o.trim());
  const user = [
    `Today: ${format(new Date(), "EEEE d MMMM yyyy")}.`,
    record && `THEIR TRACK RECORD (predictions against what happened)\n${record}`,
    `THE DECISION (${TERRAINS[d.terrain]})\n${d.title}`,
    d.problem.trim() && `In their words: ${d.problem.trim()}`,
    d.context.trim() && `Context — resources, constraints, people: ${d.context.trim()}`,
    options.length && `Options they're considering:\n${options.map((o) => `- ${o.trim()}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await askJson<Raw>({ name: "decision_tree", system: SYSTEM, user, schema: SCHEMA, effort: "high", maxTokens: 12000, timeoutMs: 300_000 });
  const pct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  return {
    brief: raw.brief,
    branches: raw.branches.map((b) => ({
      name: b.name,
      description: b.description,
      statusQuo: b.status_quo,
      unseen: b.unseen,
      probability: pct(b.probability),
      success: b.success,
      y1: b.year_1,
      y5: b.year_5,
      y10: b.year_10,
      reversibility: pct(b.reversibility),
      stopCriteria: b.stop_criteria,
    })),
    redTeam: raw.red_team,
    biases: raw.biases,
    recommendation: { ...raw.recommendation, confidence: pct(raw.recommendation.confidence) },
    generatedAt: Date.now(),
    writer: assistantName(),
  };
}
