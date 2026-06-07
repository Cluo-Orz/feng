import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { makeCliFixture, expectEnvelope, type CliFixture } from "./helpers.js";

async function createGrow(fixture: CliFixture): Promise<string> {
  const envelope = await expectEnvelope(fixture, ["grow", "create", "--title", "xiaoshuo", "--goal", "write novels", "--target", "chapters"]);
  const ref = envelope.refs[0]?.ref;
  if (ref === undefined) throw new Error("missing grow ref");
  return ref;
}

describe("cli grow run gating", () => {
  it("requires approval before running an LLM-driven attempt", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const growId = await createGrow(fixture);
      const envelope = await expectEnvelope(fixture, ["grow", "run", "--grow", growId]);
      expect(envelope.exitStatus).toBe("waiting_approval");
      expect(envelope.nextActions[0]?.kind).toBe("request_approval");
    });
  });

  it("reports invalid_state when no model is configured", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const growId = await createGrow(fixture);
      const envelope = await expectEnvelope(fixture, ["grow", "run", "--grow", growId, "--allow"]);
      expect(envelope.exitStatus).toBe("failed");
      expect(envelope.facts.join(" ")).toContain("invalid_state");
    });
  });

  it("treats preapproved_scope approval mode as authorization", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const growId = await createGrow(fixture);
      const envelope = await expectEnvelope(fixture, ["grow", "run", "--grow", growId, "--approval", "preapproved_scope"]);
      expect(envelope.exitStatus).toBe("failed");
      expect(envelope.facts.join(" ")).toContain("invalid_state");
    });
  });
});
