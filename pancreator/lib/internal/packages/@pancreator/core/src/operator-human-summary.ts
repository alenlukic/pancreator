/** Plain-language operator summaries for persona specs (not agent contract prose). */
export const PERSONA_OPERATOR_WHY: Readonly<Record<string, string>> = {
  adopter:
    "Helps you adopt Pancreator in an existing repo by scanning the stack and leaving an adoption report plus inbox items for you to ratify.",
  "compliance-auditor":
    "Runs policy and quality checks on a feature-delivery run and records what passed, what failed, and what needs a backlog follow-up.",
  "context-reviewer":
    "Reviews a bounded diff and chat context out-of-band and flags missing scope or contract drift before you merge.",
  "contract-writer":
    "Turns informal requests into machine-checkable contract clauses the rest of the pipeline can enforce.",
  coroner:
    "Diagnoses structural pain in one named workflow and writes an advisory post-mortem plan without changing the repo.",
  coder:
    "Implements the bounded touch-set for a feature-delivery run after planning gates are green.",
  "design-engineer":
    "Produces design plans and acceptance criteria during feature-delivery planning before implementation starts.",
  "design-reviewer":
    "Checks shipped UI against design canon during the test stage, alongside qa-tester.",
  "intake-analyst":
    "Turns informal inbox specs into canonical engineering specs through a short clarifying dialogue.",
  librarian:
    "Refreshes feature indexes and archives completed runs after you finish operator verification.",
  "pancreator-engineer":
    "Implements or repairs work inside the Pancreator internal corpus after inputs are normalized to contracts.",
  "persona-designer":
    "Authors new persona specs and matching Cursor projections when bootstrap or the librarian proposes a new SME.",
  "pr-writer":
    "Drafts a merge-ready pull-request summary from a feature's delivery artifacts.",
  "product-design-lead":
    "Merges product and design recommendations into one feature-delivery-ready inbox directive.",
  "product-engineer":
    "Produces product plans and acceptance criteria during feature-delivery planning.",
  "qa-tester":
    "Runs automated checks, manual QA, and visual review evidence for the test stage gate.",
  reviewer:
    "Reviews implementation against the touch-set and stage contracts before QA runs.",
  "sme-design":
    "Translates rough intent into design-canon-grounded layout and interaction recommendations during experience planning.",
  "sme-product":
    "Breaks operator goals into scoped product recommendations during experience planning.",
  supervisor:
    "Orchestrates pipeline stages, enforces gates, and prepares ship ratification for human review.",
  "tech-lead":
    "Consolidates product, design, and technical planning into an execution bundle for the coder.",
  "tech-writer":
    "Writes the delivery report when a feature-delivery run reaches the report stage.",
};

/**
 * Returns a short human-readable "why it matters" line for handbook and template docs.
 */
export function humanizeHandbookWhy(title: string, purpose: string): string {
  const cleaned = purpose.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0 || cleaned === "|") {
    return `Quick orientation for ${title} before agents load the full contract.`;
  }
  const sentenceMatch = cleaned.match(/^(.{24,220}?[.!?])(?:\s|$)/);
  if (sentenceMatch) {
    return sentenceMatch[1]
      .replace(/\bSHALL\b/gi, "")
      .replace(/\bMUST NOT\b/gi, "must not")
      .replace(/\bMUST\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  const clipped = cleaned.slice(0, 200).replace(/\s+\S*$/, "");
  return clipped.length > 0 ? `${clipped}.` : `Quick orientation for ${title}.`;
}

export function personaOperatorWhy(name: string, _description: string): string {
  return (
    PERSONA_OPERATOR_WHY[name] ??
    `Defines when and how agents invoke the ${name} persona during pipeline work.`
  );
}
