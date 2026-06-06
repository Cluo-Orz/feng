import { describe, expect, test } from "vitest";
import type { ArtifactRecord, ArtifactRegistry } from "../../src/artifact-registry/index.js";
import { makeArtifactId, makeGrowUnitId, makeMessageListId, makePolicyDecisionId, makeRef, makeToolId, type ArtifactRef } from "../../src/domain/index.js";
import { domainErr, ok, type Result } from "../../src/domain/result.js";
import { registerJsonArtifact, registerReports, warningsFor } from "../../src/context-message-compiler/artifact-writer.js";
import { fitSectionsToBudget, normalizeBudget } from "../../src/context-message-compiler/budget.js";
import { readBudgetReportRecord, readSourceMapRecord } from "../../src/context-message-compiler/read-flow.js";
import { readArtifactForContext } from "../../src/context-message-compiler/source-readers.js";
import { exclusionParts, toolParts } from "../../src/context-message-compiler/section-parts.js";
import type { ContextCompileInput, ContextSection, ExclusionRecord } from "../../src/context-message-compiler/index.js";

describe("Context & Message Compiler edge helpers", () => {
  test("source reader turns artifact states and materialization failures into exclusions", async () => {
    const ref = artifactRef("stateful");
    const cases: [string, ArtifactRegistry, string][] = [
      ["missing", registry({ resolve: domainErr({ code: "not_found", message: "missing", module: "test" }) }), "artifact_unavailable"],
      ["secret", registry({ record: record(ref, { privacyClass: "contains_secret" }) }), "privacy_blocked"],
      ["redacted", registry({ record: record(ref, { lifecycle: "redacted" }) }), "redacted"],
      ["retracted", registry({ record: record(ref, { lifecycle: "retracted" }) }), "retracted"],
      ["deleted", registry({ record: record(ref, { lifecycle: "deleted" }) }), "artifact_unavailable"],
      ["unavailable", registry({ record: record(ref, { lifecycle: "unavailable" }) }), "artifact_unavailable"],
      ["read-error", registry({
        record: record(ref),
        materialize: domainErr({ code: "io_failed", message: "read failed", module: "test" })
      }), "artifact_unavailable"],
      ["status-redacted", registry({
        record: record(ref),
        materialize: ok({ artifactRef: ref, status: "redacted", truncated: false, redacted: true, privacyClass: "public", source: source(), version })
      }), "redacted"],
      ["status-retracted", registry({
        record: record(ref),
        materialize: ok({ artifactRef: ref, status: "retracted", truncated: false, redacted: false, privacyClass: "public", source: source(), version })
      }), "retracted"],
      ["status-unavailable", registry({
        record: record(ref),
        materialize: ok({ artifactRef: ref, status: "unavailable", truncated: false, redacted: false, privacyClass: "public", source: source(), version })
      }), "artifact_unavailable"]
    ];
    for (const [, fakeRegistry, expected] of cases) {
      const result = await readArtifactForContext({
        registry: fakeRegistry,
        ref,
        reason: "edge",
        section: "evidence_summary",
        maxBytes: 16
      });
      expect(result.exclusions[0]?.reason).toBe(expected);
      expect(result.part).toBeUndefined();
    }
  });

  test("source reader records binary and bounded text materialization", async () => {
    const binaryRef = artifactRef("binary");
    const binary = await readArtifactForContext({
      registry: registry({
        record: record(binaryRef, { size: 4 }),
        materialize: ok({
          artifactRef: binaryRef,
          status: "available",
          content: new Uint8Array([1, 2, 3, 4]),
          truncated: false,
          redacted: false,
          privacyClass: "public",
          source: source(),
          version
        })
      }),
      ref: binaryRef,
      reason: "binary",
      section: "evidence_summary",
      maxBytes: 16
    });
    expect(binary.part?.text).toContain("binary artifact");
    const largeRef = artifactRef("large");
    const large = await readArtifactForContext({
      registry: registry({
        record: record(largeRef, { size: 100 }),
        materialize: ok({
          artifactRef: largeRef,
          status: "available",
          content: "large text",
          truncated: false,
          redacted: false,
          privacyClass: "public",
          source: source(),
          version
        })
      }),
      ref: largeRef,
      reason: "large",
      section: "evidence_summary",
      maxBytes: 8
    });
    expect(large.part?.truncated).toBe(true);
    expect(large.exclusions[0]?.reason).toBe("out_of_budget");
  });

  test("budget fitting covers short over-budget and long truncation paths", () => {
    const normalized = normalizeBudget({ totalBudget: 1000, sectionBudgets: { grow_goal: 123 } }, 8000);
    expect(normalized.sectionBudgets.grow_goal).toBe(123);
    const short = section("visible_tools", "tiny", 10, 20);
    const long = section("evidence_summary", "long ".repeat(200), 5, 20);
    const fitted = fitSectionsToBudget({
      messageListRef: makeRef("message_list", makeMessageListId("message-list-edge")),
      sections: [short, long],
      budget: { totalBudget: 30, sectionBudgets: { visible_tools: 1, evidence_summary: 10 } },
      exclusions: [],
      unavailableSources: ["missing artifact"],
      builtAt: "2026-06-06T00:00:00.000Z"
    });
    expect(fitted.sections.some((item) => item.truncated)).toBe(true);
    expect(fitted.exclusions.some((item) => item.reason === "out_of_budget")).toBe(true);
    const stillOver = fitSectionsToBudget({
      messageListRef: makeRef("message_list", makeMessageListId("message-list-short")),
      sections: [section("core_invariants", "a".repeat(40), 1, 10), section("grow_goal", "b".repeat(40), 1, 10)],
      budget: { totalBudget: 1, sectionBudgets: { core_invariants: 1, grow_goal: 1 } },
      exclusions: [],
      unavailableSources: [],
      builtAt: "2026-06-06T00:00:00.000Z"
    });
    expect(stillOver.report.overBudget).toBe(true);
  });

  test("tool and exclusion section helpers preserve policy ids and nonempty summaries", () => {
    const exclusions: ExclusionRecord[] = [];
    const policyDecisionId = makePolicyDecisionId("policy-edge");
    const parts = toolParts([
      {
        toolId: makeToolId("tool-safe-edge"),
        name: "safe-edge",
        capabilitySummary: "read only",
        policyBoundarySummary: "artifact.read",
        inclusionReason: "safe summary",
        safeForModel: true,
        policyDecisionId
      },
      {
        toolId: makeToolId("tool-unsafe-edge"),
        name: "unsafe-edge",
        capabilitySummary: "execute",
        policyBoundarySummary: "command.run",
        inclusionReason: "unsafe summary",
        safeForModel: false,
        policyDecisionId
      }
    ], exclusions);
    expect(parts[0]?.policyDecisionId).toBe(policyDecisionId);
    expect(exclusions[0]?.policyDecisionId).toBe(policyDecisionId);
    expect(exclusionParts(exclusions, makeRef("message_list", makeMessageListId("message-list-exclusion")))[0]?.text)
      .toContain("unsafe_tool_surface");
  });

  test("artifact writer covers parent selection, report failures, and warnings", async () => {
    const input = compileInput();
    const parentRefs = [artifactRef("parent")];
    const emptyRegistry = writeRegistry();
    const plain = await registerJsonArtifact(writerRuntime(emptyRegistry), {
      kind: "summary",
      content: { ok: true },
      parentRefs: [],
      input
    });
    expect(plain.ok).toBe(true);
    expect(emptyRegistry.registered).toBe(1);
    const derivedRegistry = writeRegistry();
    const derived = await registerJsonArtifact(writerRuntime(derivedRegistry), {
      kind: "summary",
      content: { ok: true },
      parentRefs,
      input: { ...input, correlationId: "corr-edge" }
    });
    expect(derived.ok).toBe(true);
    expect(derivedRegistry.derived).toBe(1);
    for (const failAt of [1, 2, 3]) {
      const failed = await registerReports(
        writerRuntime(writeRegistry(failAt)),
        input,
        messageListRef("report-edge"),
        { messageListRef: messageListRef("source-map"), entries: [], builtAt: input.audit.createdAt },
        {
          messageListRef: messageListRef("budget"),
          budgetModel: "rough_char_tokens",
          totalBudget: 1,
          sectionBudgets: [],
          estimatedUsage: 2,
          overBudget: true,
          compressionApplied: true,
          truncationApplied: true,
          unavailableSources: [],
          builtAt: input.audit.createdAt
        },
        { messageListRef: messageListRef("exclusion"), records: [], builtAt: input.audit.createdAt },
        parentRefs
      );
      expect(failed.ok).toBe(false);
    }
    expect(warningsFor({
      messageListRef: messageListRef("warnings"),
      budgetModel: "rough_char_tokens",
      totalBudget: 1,
      sectionBudgets: [],
      estimatedUsage: 2,
      overBudget: true,
      compressionApplied: true,
      truncationApplied: true,
      unavailableSources: [],
      builtAt: input.audit.createdAt
    }, { messageListRef: messageListRef("warnings"), records: [], builtAt: input.audit.createdAt }))
      .toContain("message list remains over budget after truncation");
  });

  test("read flow maps unavailable reports and non-text report content to domain errors", async () => {
    const redacted = await readSourceMapRecord(readRuntime(ok({
      artifactRef: artifactRef("source-map-report"),
      status: "redacted",
      truncated: false,
      redacted: true,
      privacyClass: "workspace_private",
      source: source(),
      version
    })), messageListRef("read-redacted"));
    expect(redacted.ok).toBe(false);
    if (!redacted.ok) expect(redacted.error.code).toBe("privacy_blocked");
    const binary = await readSourceMapRecord(readRuntime(ok({
      artifactRef: artifactRef("source-map-binary"),
      status: "available",
      content: new Uint8Array([1, 2, 3]),
      truncated: false,
      redacted: false,
      privacyClass: "workspace_private",
      source: source(),
      version
    })), messageListRef("read-binary"));
    expect(binary.ok).toBe(false);
    if (!binary.ok) expect(binary.error.code).toBe("unsupported_encoding");
    const missingRecord = await readBudgetReportRecord({
      storage: { readMessageList: async () => domainErr({ code: "not_found", message: "missing", module: "test" }) }
    } as never, messageListRef("missing-record"));
    expect(missingRecord.ok).toBe(false);
  });
});

const version = { schemaVersion: "1", producerVersion: "edge-test" };

function artifactRef(id: string): ArtifactRef {
  return makeRef("artifact", makeArtifactId(`artifact-${id}`));
}

function messageListRef(id: string) {
  return makeRef("message_list", makeMessageListId(`message-list-${id}`));
}

function compileInput(): ContextCompileInput {
  return {
    growUnitRef: makeRef("grow_unit", makeGrowUnitId("grow-edge")),
    compileReason: "edge compile",
    source: source(),
    version,
    audit: { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "edge-test", reason: "edge compile" }
  };
}

function source() {
  return {
    kind: "system" as const,
    origin: "edge-test",
    userProvided: false,
    receivedAt: "2026-06-06T00:00:00.000Z",
    privacyLevel: "public" as const
  };
}

function record(ref: ArtifactRef, extra: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    artifactId: ref.id,
    artifactRef: ref,
    kind: "summary",
    lifecycle: "active",
    contentLocation: { kind: "managed", logicalPath: ".feng/artifacts/edge.json" },
    size: 4,
    mediaType: "text/plain",
    encoding: "utf8",
    source: source(),
    version,
    audit: { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "edge-test", reason: "edge" },
    privacyClass: "public",
    retentionClass: "grow_scoped",
    parentRefs: [],
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
    producerModule: "human",
    ...extra
  };
}

function registry(input: {
  readonly record?: ArtifactRecord;
  readonly resolve?: Result<ArtifactRecord>;
  readonly materialize?: Result<unknown>;
}): ArtifactRegistry {
  return {
    resolveArtifact: async () => input.resolve ?? ok(input.record ?? record(artifactRef("default"))),
    materializeArtifact: async () => input.materialize as never,
    registerArtifact: async () => { throw new Error("not used"); },
    registerDerivedArtifact: async () => { throw new Error("not used"); },
    registerExternalHandle: async () => { throw new Error("not used"); },
    readArtifactRange: async () => { throw new Error("not used"); },
    generatePreview: async () => { throw new Error("not used"); },
    updatePreview: async () => { throw new Error("not used"); },
    readArtifactPreview: async () => { throw new Error("not used"); },
    archiveArtifact: async () => { throw new Error("not used"); },
    redactArtifact: async () => { throw new Error("not used"); },
    markUnavailable: async () => { throw new Error("not used"); },
    retractArtifact: async () => { throw new Error("not used"); },
    deleteArtifactContent: async () => { throw new Error("not used"); }
  } as ArtifactRegistry;
}

function writeRegistry(failAt?: number): ArtifactRegistry & { registered: number; derived: number } {
  let calls = 0;
  const state = {
    registered: 0,
    derived: 0,
    registerArtifact: async () => writeResult(++calls, failAt, () => {
      state.registered += 1;
      return artifactRef(`registered-${calls}`);
    }),
    registerDerivedArtifact: async () => writeResult(++calls, failAt, () => {
      state.derived += 1;
      return artifactRef(`derived-${calls}`);
    }),
    resolveArtifact: async () => { throw new Error("not used"); },
    materializeArtifact: async () => { throw new Error("not used"); },
    registerExternalHandle: async () => { throw new Error("not used"); },
    readArtifactRange: async () => { throw new Error("not used"); },
    generatePreview: async () => { throw new Error("not used"); },
    updatePreview: async () => { throw new Error("not used"); },
    readArtifactPreview: async () => { throw new Error("not used"); },
    archiveArtifact: async () => { throw new Error("not used"); },
    redactArtifact: async () => { throw new Error("not used"); },
    markUnavailable: async () => { throw new Error("not used"); },
    retractArtifact: async () => { throw new Error("not used"); },
    deleteArtifactContent: async () => { throw new Error("not used"); }
  };
  return state as ArtifactRegistry & { registered: number; derived: number };
}

function writeResult(call: number, failAt: number | undefined, value: () => ArtifactRef): Result<ArtifactRef> {
  return call === failAt
    ? domainErr({ code: "io_failed", message: `fail ${call}`, module: "test" })
    : ok(value());
}

function writerRuntime(artifactRegistry: ArtifactRegistry) {
  return { options: { artifactRegistry } } as never;
}

function readRuntime(materialize: Result<unknown>) {
  return {
    storage: {
      readMessageList: async () => ok({
        sourceMapRef: artifactRef("source-map-report"),
        budgetReportRef: artifactRef("budget-report"),
        exclusionListRef: artifactRef("exclusion-report"),
        compileReportRef: artifactRef("compile-report")
      })
    },
    options: {
      artifactRegistry: {
        materializeArtifact: async () => materialize
      }
    }
  } as never;
}

function section(kind: ContextSection["kind"], content: string, priority: number, budget: number): ContextSection {
  return {
    sectionId: `${kind}-edge`,
    kind,
    title: kind,
    content,
    priority,
    sourceMapEntryIds: ["source-edge"],
    estimatedTokens: budget,
    truncated: false,
    redacted: false
  };
}
