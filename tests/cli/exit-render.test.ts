import { describe, expect, it } from "vitest";
import { createDomainError } from "../../src/domain/index.js";
import {
  exitCodeForStatus,
  makeCLIInvocationId,
  mapErrorToExitStatus,
  renderEnvelope,
  type CLICommandIntent,
  type CLIHandlerResult
} from "../../src/cli/index.js";

function makeIntent(extra: Partial<CLICommandIntent> = {}): CLICommandIntent {
  return {
    raw: [],
    family: "artifact",
    action: "show",
    positionals: [],
    flags: {},
    requestedMode: "normal",
    approvalMode: "ask",
    displayMode: "human_summary",
    workspaceRoot: "/tmp/ws",
    ...extra
  };
}

const baseResult: CLIHandlerResult = {
  exitStatus: "succeeded",
  headline: "ok",
  facts: ["fact a"],
  refs: [{ label: "artifact", ref: "a1", uri: "artifact://a1" }],
  warnings: [],
  nextActions: [{ kind: "run_command", summary: "do next", command: "feng status" }]
};

const id = makeCLIInvocationId("cli-invocation-test");

describe("cli exit mapping", () => {
  it("maps policy and privacy errors to blocked statuses", () => {
    expect(mapErrorToExitStatus(createDomainError({ module: "x", code: "policy_blocked", message: "" }))).toBe("blocked_by_policy");
    expect(mapErrorToExitStatus(createDomainError({ module: "x", code: "privacy_blocked", message: "" }))).toBe("blocked_by_privacy");
    expect(mapErrorToExitStatus(createDomainError({ module: "x", code: "approval_required", message: "" }))).toBe("waiting_approval");
    expect(mapErrorToExitStatus(createDomainError({ module: "x", code: "readiness_failed", message: "" }))).toBe("blocked_by_readiness");
    expect(mapErrorToExitStatus(createDomainError({ module: "x", code: "boundary_unsupported", message: "" }))).toBe("unsupported");
    expect(mapErrorToExitStatus(createDomainError({ module: "x", code: "cancelled", message: "" }))).toBe("interrupted");
    expect(mapErrorToExitStatus(createDomainError({ module: "x", code: "io_failed", message: "" }))).toBe("failed");
  });

  it("maps statuses to stable exit codes", () => {
    expect(exitCodeForStatus("succeeded")).toBe(0);
    expect(exitCodeForStatus("failed")).toBe(1);
    expect(exitCodeForStatus("blocked_by_policy")).toBe(5);
    expect(exitCodeForStatus("interrupted")).toBe(130);
  });
});

describe("cli render", () => {
  it("renders human summary with facts and next actions", () => {
    const envelope = renderEnvelope(id, makeIntent(), baseResult);
    expect(envelope.rendered).toContain("ok");
    expect(envelope.rendered).toContain("fact a");
    expect(envelope.rendered).toContain("do next");
    expect(envelope.exitCode).toBe(0);
  });

  it("renders quiet output as just the status", () => {
    const envelope = renderEnvelope(id, makeIntent({ displayMode: "quiet" }), baseResult);
    expect(envelope.rendered).toBe("succeeded");
  });

  it("renders source refs", () => {
    const envelope = renderEnvelope(id, makeIntent({ displayMode: "source_refs" }), baseResult);
    expect(envelope.rendered).toContain("artifact://a1");
  });

  it("renders machine readable json", () => {
    const envelope = renderEnvelope(id, makeIntent({ displayMode: "json", requestedMode: "machine_readable" }), {
      ...baseResult,
      data: { detail: "value" }
    });
    expect(JSON.parse(envelope.rendered).data.detail).toBe("value");
  });

  it("strips data, refs and facts when blocked by privacy", () => {
    const envelope = renderEnvelope(id, makeIntent({ displayMode: "json", requestedMode: "machine_readable" }), {
      ...baseResult,
      exitStatus: "blocked_by_privacy",
      data: { secret: "leak" }
    });
    expect(envelope.data).toBeUndefined();
    expect(envelope.refs).toEqual([]);
    expect(envelope.facts).toEqual([]);
    expect(envelope.rendered).not.toContain("leak");
    expect(envelope.exitCode).toBe(6);
  });

  it("strips refs when blocked by policy", () => {
    const envelope = renderEnvelope(id, makeIntent(), { ...baseResult, exitStatus: "blocked_by_policy" });
    expect(envelope.refs).toEqual([]);
  });

  it("renders verbose output with refs and command-less next actions", () => {
    const envelope = renderEnvelope(id, makeIntent({ displayMode: "verbose" }), {
      ...baseResult,
      nextActions: [{ kind: "wait", summary: "await approval" }]
    });
    expect(envelope.rendered).toContain("artifact://a1");
    expect(envelope.rendered).toContain("await approval");
    expect(envelope.rendered).not.toContain("->");
  });
});
