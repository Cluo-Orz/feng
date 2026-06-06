import { sha256Text } from "../event-ledger/stable-json.js";
import { estimateTokens } from "./budget.js";
import type {
  ContextSection,
  ContextSectionKind,
  ContextSourceRef,
  ContextSourceType,
  SourceMapEntry
} from "./types.js";
import type { PolicyDecisionId, VersionDescriptor } from "../domain/index.js";

export interface SectionPart {
  readonly text: string;
  readonly sourceType: ContextSourceType;
  readonly sourceRef?: ContextSourceRef;
  readonly sourceVersion?: VersionDescriptor;
  readonly inclusionReason: string;
  readonly transformation: string;
  readonly redacted?: boolean;
  readonly truncated?: boolean;
  readonly policyDecisionId?: PolicyDecisionId;
}

export interface ComposedSections {
  readonly sections: readonly ContextSection[];
  readonly entries: readonly SourceMapEntry[];
}

export class SectionComposer {
  private readonly sections: ContextSection[] = [];
  private readonly entries: SourceMapEntry[] = [];
  private sequence = 0;

  addSection(input: {
    readonly kind: ContextSectionKind;
    readonly title: string;
    readonly priority: number;
    readonly parts: readonly SectionPart[];
  }): void {
    const sectionId = `${input.kind}-${this.sections.length + 1}`;
    const texts = input.parts.length === 0
      ? ["Not available for this compile."]
      : input.parts.map((part) => part.text.trim()).filter((text) => text.length > 0);
    const content = texts.length === 0 ? "Not available for this compile." : texts.join("\n");
    const entryIds = input.parts.map((part, index) => this.addEntry(sectionId, input.kind, index, part));
    if (entryIds.length === 0) {
      entryIds.push(this.addEntry(sectionId, input.kind, 0, {
        text: content,
        sourceType: "manual_instruction",
        inclusionReason: "section absence is explicitly represented",
        transformation: "fallback placeholder"
      }));
    }
    this.sections.push({
      sectionId,
      kind: input.kind,
      title: input.title,
      content,
      priority: input.priority,
      sourceMapEntryIds: entryIds,
      estimatedTokens: estimateTokens(content),
      truncated: input.parts.some((part) => part.truncated === true),
      redacted: input.parts.some((part) => part.redacted === true)
    });
  }

  build(): ComposedSections {
    return { sections: this.sections, entries: this.entries };
  }

  private addEntry(
    sectionId: string,
    kind: ContextSectionKind,
    index: number,
    part: SectionPart
  ): string {
    const entryId = `source-${++this.sequence}`;
    this.entries.push({
      entryId,
      messagePath: `sections.${sectionId}.content.${index}`,
      section: kind,
      sourceType: part.sourceType,
      ...(part.sourceRef === undefined ? {} : { sourceRef: part.sourceRef }),
      ...(part.sourceVersion === undefined ? {} : { sourceVersion: part.sourceVersion }),
      inclusionReason: part.inclusionReason,
      transformation: part.transformation,
      redacted: part.redacted ?? false,
      truncated: part.truncated ?? false,
      ...(part.policyDecisionId === undefined ? {} : { policyDecisionId: part.policyDecisionId }),
      contentHash: sha256Text(part.text)
    });
    return entryId;
  }
}

export function markTruncatedEntries(
  entries: readonly SourceMapEntry[],
  sections: readonly ContextSection[]
): readonly SourceMapEntry[] {
  const truncatedSections = new Set(sections.filter((section) => section.truncated).map((section) => section.kind));
  return entries.map((entry) => truncatedSections.has(entry.section) ? { ...entry, truncated: true } : entry);
}
