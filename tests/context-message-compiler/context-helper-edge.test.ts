import { describe, expect, test } from "vitest";
import { makeMessageListId, makeRef, makeSkillId } from "../../src/domain/index.js";
import { domainErr, ok } from "../../src/domain/result.js";
import { SectionComposer } from "../../src/context-message-compiler/section-builder.js";
import { addAdmissionSections, addSkillSection } from "../../src/context-message-compiler/section-parts.js";
import { readBudgetReportRecord, readExclusionListRecord } from "../../src/context-message-compiler/read-flow.js";
import type { ActiveSkillScopeSummary } from "../../src/grow-unit-manager/index.js";
import type { ActiveSkillSummary } from "../../src/agenda-dod-manager/index.js";
import type { ContextCompileInput, ExclusionRecord } from "../../src/context-message-compiler/index.js";

describe("Context helper error branches", () => {
  test("admission section records explanation failures for visible refs", async () => {
    const composer = new SectionComposer();
    const inboxRef = { kind: "inbox_item" as const, id: "inbox-edge" as never };
    const feedbackRef = { kind: "feedback_unit" as const, id: "feedback-edge" as never };
    const state = edgeState();
    await addAdmissionSections(
      { options: { admissionInbox: { explainAdmissionDecision: async () => domainErr({ code: "not_found", message: "missing explanation", module: "test" }) } } } as never,
      composer,
      compileInput(),
      [inboxRef, feedbackRef],
      [inboxRef],
      [feedbackRef],
      state
    );
    expect(state.exclusions).toHaveLength(2);
    expect(state.exclusions.every((item) => item.reason === "artifact_unavailable")).toBe(true);
  });

  test("skill section records summary and body materialization failures", async () => {
    const failedSkill = skill("failed-summary");
    const bodyBlocked = skill("body-blocked");
    const bodySecret = skill("body-secret");
    const active: ActiveSkillScopeSummary[] = [
      { ...failedSkill, sourceKind: "workspace_local" },
      { ...bodyBlocked, sourceKind: "workspace_local" },
      { ...bodySecret, sourceKind: "workspace_local" }
    ];
    const visible: ActiveSkillSummary[] = [failedSkill, bodyBlocked, bodySecret];
    const state = edgeState();
    const composer = new SectionComposer();
    await addSkillSection(
      {
        options: {
          skillRegistry: {
            loadSkillSummary: async (ref: typeof failedSkill.skillRef) => ref.id === failedSkill.skillRef.id
              ? domainErr({ code: "not_found", message: "skill missing", module: "test" })
              : ok({
                skillRef: ref,
                name: "body-blocked",
                family: "edge",
                version,
                description: "has blocked body",
                triggerSummary: "edge",
                declaredCapabilities: [],
                declaredToolRefs: [],
                sourceKind: "workspace_local",
                lifecycle: "active"
              }),
            loadSkillBody: async (ref: typeof failedSkill.skillRef) => ref.id === bodySecret.skillRef.id
              ? ok({ content: "SECRET_SKILL_BODY", privacyClass: "contains_secret", version, skillRef: ref, bodyRef: makeRef("artifact", "artifact-skill-secret" as never) })
              : domainErr({ code: "privacy_blocked", message: "body private", module: "test" })
          }
        }
      } as never,
      composer,
      { ...compileInput(), skillBodyMode: "bounded_body" },
      active,
      visible,
      state
    );
    expect(state.exclusions.map((item) => item.reason)).toEqual(["incompatible_version", "privacy_blocked", "privacy_blocked"]);
    expect(composer.build().sections[0]?.content).not.toContain("SECRET_SKILL_BODY");
  });

  test("read flow propagates materialization failures and successful exclusion reads", async () => {
    const failed = await readBudgetReportRecord(readRuntime(domainErr({ code: "io_failed", message: "disk", module: "test" })), messageListRef("budget-fail"));
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("io_failed");
    const exclusion = await readExclusionListRecord(readRuntime(ok({
      artifactRef: artifactRef("exclusion"),
      status: "available",
      content: JSON.stringify({ messageListRef: messageListRef("ok"), records: [], builtAt: "2026-06-06T00:00:00.000Z" }),
      truncated: false,
      redacted: false,
      privacyClass: "workspace_private",
      source: source(),
      version
    })), messageListRef("exclusion-ok"));
    expect(exclusion.ok).toBe(true);
  });
});

const version = { schemaVersion: "1", producerVersion: "helper-edge" };

function compileInput(): ContextCompileInput {
  return {
    growUnitRef: makeRef("grow_unit", "grow-helper-edge" as never),
    compileReason: "helper edge",
    source: source(),
    version,
    audit: { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "helper-edge", reason: "helper edge" }
  };
}

function skill(id: string): ActiveSkillSummary {
  return {
    skillRef: makeRef("skill", makeSkillId(`skill-${id}`)),
    name: id,
    family: "edge",
    version
  };
}

function messageListRef(id: string) {
  return makeRef("message_list", makeMessageListId(`message-list-${id}`));
}

function artifactRef(id: string) {
  return makeRef("artifact", `artifact-${id}` as never);
}

function source() {
  return {
    kind: "system" as const,
    origin: "helper-edge",
    userProvided: false,
    receivedAt: "2026-06-06T00:00:00.000Z",
    privacyLevel: "workspace_private" as const
  };
}

function readRuntime(materialize: unknown) {
  return {
    storage: {
      readMessageList: async () => ok({
        sourceMapRef: artifactRef("source-map"),
        budgetReportRef: artifactRef("budget"),
        exclusionListRef: artifactRef("exclusion"),
        compileReportRef: artifactRef("compile")
      })
    },
    options: { artifactRegistry: { materializeArtifact: async () => materialize } }
  } as never;
}

function edgeState() {
  return { exclusions: [] as ExclusionRecord[], unavailable: [], sourceRefs: [], excludedRefs: [] };
}
