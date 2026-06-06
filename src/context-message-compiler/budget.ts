import type {
  BudgetReport,
  ContextBudgetInput,
  ContextSection,
  ContextSectionKind,
  ExclusionRecord,
  SectionBudget
} from "./types.js";
import { contextSectionKinds } from "./types.js";
import type { MessageListRef } from "../domain/index.js";

export const defaultTotalBudget = 8_000;

const defaultSectionWeights: Record<ContextSectionKind, number> = {
  core_invariants: 1,
  grow_goal: 2,
  target_world_summary: 1,
  agenda_and_dod: 2,
  admitted_materials: 2,
  feedback_state: 1,
  evidence_summary: 2,
  visible_skills: 1,
  visible_tools: 1,
  policy_boundaries: 1,
  attempt_intent: 2,
  output_expectation: 1,
  excluded_or_unavailable_summary: 1
};

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function normalizeBudget(input: ContextBudgetInput | undefined, fallbackTotal: number): Required<ContextBudgetInput> {
  const totalBudget = Math.max(200, Math.floor(input?.totalBudget ?? fallbackTotal));
  const sectionBudgets = allocateSectionBudgets(totalBudget, input?.sectionBudgets ?? {});
  return { totalBudget, sectionBudgets };
}

export function fitSectionsToBudget(input: {
  readonly messageListRef: MessageListRef;
  readonly sections: readonly ContextSection[];
  readonly budget: Required<ContextBudgetInput>;
  readonly exclusions: readonly ExclusionRecord[];
  readonly unavailableSources: readonly string[];
  readonly builtAt: string;
}): { readonly sections: readonly ContextSection[]; readonly exclusions: readonly ExclusionRecord[]; readonly report: BudgetReport } {
  const exclusions = [...input.exclusions];
  const fitted = input.sections.map((section) => fitSection(section, budgetForSection(input.budget, section.kind), exclusions));
  let total = fitted.reduce((sum, section) => sum + section.estimatedTokens, 0);
  const sorted = [...fitted].sort((a, b) => a.priority - b.priority);
  for (const section of sorted) {
    if (total <= input.budget.totalBudget) break;
    if (section.content.length <= 80) continue;
    const overflow = total - input.budget.totalBudget;
    const trimTokens = Math.min(section.estimatedTokens - 20, overflow);
    const targetChars = Math.max(80, section.content.length - trimTokens * 4);
    const replacement = truncateSection(section, targetChars);
    total += replacement.estimatedTokens - section.estimatedTokens;
    const index = fitted.findIndex((item) => item.sectionId === section.sectionId);
    if (index >= 0) fitted[index] = replacement;
    exclusions.push({
      sourceType: "manual_instruction",
      reason: "out_of_budget",
      summary: `Section ${section.kind} truncated to fit total context budget`,
      section: section.kind
    });
  }
  const sectionBudgets: SectionBudget[] = contextSectionKinds.map((section) => ({
    section,
    budget: budgetForSection(input.budget, section),
    estimatedUsage: fitted.filter((item) => item.kind === section).reduce((sum, item) => sum + item.estimatedTokens, 0)
  }));
  const truncationApplied = fitted.some((section) => section.truncated) ||
    exclusions.some((record) => record.reason === "out_of_budget");
  return {
    sections: fitted,
    exclusions,
    report: {
      messageListRef: input.messageListRef,
      budgetModel: "rough_char_tokens",
      totalBudget: input.budget.totalBudget,
      sectionBudgets,
      estimatedUsage: fitted.reduce((sum, section) => sum + section.estimatedTokens, 0),
      overBudget: fitted.reduce((sum, section) => sum + section.estimatedTokens, 0) > input.budget.totalBudget,
      compressionApplied: truncationApplied,
      truncationApplied,
      unavailableSources: input.unavailableSources,
      builtAt: input.builtAt
    }
  };
}

function allocateSectionBudgets(
  totalBudget: number,
  overrides: Partial<Record<ContextSectionKind, number>>
): Partial<Record<ContextSectionKind, number>> {
  const fixed = Object.values(overrides).reduce((sum, value) => sum + Math.max(0, Math.floor(value ?? 0)), 0);
  const remaining = Math.max(0, totalBudget - fixed);
  const weightTotal = contextSectionKinds
    .filter((section) => overrides[section] === undefined)
    .reduce((sum, section) => sum + defaultSectionWeights[section], 0);
  const allocated: Partial<Record<ContextSectionKind, number>> = { ...overrides };
  for (const section of contextSectionKinds) {
    if (allocated[section] !== undefined) continue;
    allocated[section] = Math.max(40, Math.floor((remaining * defaultSectionWeights[section]) / weightTotal));
  }
  return allocated;
}

function fitSection(
  section: ContextSection,
  budget: number,
  exclusions: ExclusionRecord[]
): ContextSection {
  if (section.estimatedTokens <= budget || section.content.length <= 80) return section;
  exclusions.push({
    sourceType: "manual_instruction",
    reason: "out_of_budget",
    summary: `Section ${section.kind} exceeded its section budget`,
    section: section.kind
  });
  return truncateSection(section, budget * 4);
}

function truncateSection(section: ContextSection, maxChars: number): ContextSection {
  const content = `${section.content.slice(0, Math.max(20, maxChars - 36)).trimEnd()}\n[truncated by context budget]`;
  return { ...section, content, estimatedTokens: estimateTokens(content), truncated: true };
}

function budgetForSection(input: Required<ContextBudgetInput>, section: ContextSectionKind): number {
  return Math.max(40, Math.floor(input.sectionBudgets[section] ?? input.totalBudget / contextSectionKinds.length));
}
