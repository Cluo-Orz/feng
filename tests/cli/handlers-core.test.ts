import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { makeCliFixture, expectEnvelope, type CliFixture } from "./helpers.js";

async function createGrow(fixture: CliFixture): Promise<string> {
  const envelope = await expectEnvelope(fixture, [
    "grow",
    "create",
    "--title",
    "Boss agent",
    "--goal",
    "beat the boss",
    "--target",
    "dodge in rage"
  ]);
  expect(envelope.exitStatus).toBe("succeeded");
  const ref = envelope.refs[0]?.ref;
  if (ref === undefined) throw new Error("grow ref missing");
  return ref;
}

describe("cli core handlers", () => {
  it("reports an empty workspace before any grow unit exists", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const envelope = await expectEnvelope(fixture, ["workspace"]);
      expect(envelope.exitStatus).toBe("succeeded");
      expect(envelope.headline).toContain("no grow unit");
    });
  });

  it("creates, lists, shows and explains a grow unit", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const growId = await createGrow(fixture);

      const status = await expectEnvelope(fixture, ["workspace"]);
      expect(status.refs[0]?.ref).toBe(growId);

      const list = await expectEnvelope(fixture, ["grow", "list"]);
      expect(list.data?.["total"]).toBeGreaterThanOrEqual(1);

      const def = await expectEnvelope(fixture, ["grow"]);
      expect(def.exitStatus).toBe("succeeded");

      const show = await expectEnvelope(fixture, ["grow", "show", "--grow", growId]);
      expect(show.facts.join(" ")).toContain("Boss agent");

      const explain = await expectEnvelope(fixture, ["grow", "explain", "--grow", growId]);
      expect(explain.exitStatus).toBe("succeeded");
    });
  });

  it("routes user input through admission and lists pending inbox", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const growId = await createGrow(fixture);

      const submit = await expectEnvelope(fixture, ["input", "submit", "--grow", growId, "--text", "make boss harder"]);
      expect(submit.exitStatus).toBe("succeeded");
      expect(submit.headline).toContain("received into inbox");
      expect(submit.refs[0]?.ref).toBeDefined();

      const list = await expectEnvelope(fixture, ["input", "list", "--grow", growId]);
      expect(list.data?.["total"]).toBeGreaterThanOrEqual(1);
    });
  });

  it("admits an input as visible material when --admit is set", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const growId = await createGrow(fixture);
      const admitted = await expectEnvelope(fixture, [
        "input", "submit", "--grow", growId,
        "--text", "第一章梗概：李白穿越现代成都地铁。",
        "--summary", "第一章：李白穿越现代成都。",
        "--admit"
      ]);
      expect(admitted.exitStatus).toBe("succeeded");
      expect(admitted.headline).toContain("admitted as material");
    });
  });

  it("builds an aggregated status and explanation", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const growId = await createGrow(fixture);

      const status = await expectEnvelope(fixture, ["status", "--grow", growId]);
      expect(["succeeded", "succeeded_with_warnings"]).toContain(status.exitStatus);

      const explain = await expectEnvelope(fixture, ["explain", "--grow", growId]);
      expect(explain.exitStatus).toBe("succeeded");
    });
  });

  it("lists feedback units for a grow unit", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const growId = await createGrow(fixture);
      const feedback = await expectEnvelope(fixture, ["feedback", "--grow", growId]);
      expect(feedback.exitStatus).toBe("succeeded");
      expect(feedback.data?.["total"]).toBe(0);
    });
  });

  it("persists an invocation receipt and indexes it", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const envelope = await expectEnvelope(fixture, ["grow", "list"]);
      const receipt = await fixture.cli.getInvocationReceipt(envelope.invocationId);
      expect(receipt.ok).toBe(true);
      if (receipt.ok) expect(receipt.value.family).toBe("grow");
      const all = await fixture.cli.listInvocations();
      expect(all.ok).toBe(true);
      if (all.ok) expect(all.value.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("fails with invalid_input when required args are missing", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const missingTitle = await expectEnvelope(fixture, ["grow", "create"]);
      expect(missingTitle.exitStatus).toBe("failed");

      const unknownAction = await expectEnvelope(fixture, ["grow", "frobnicate", "--grow", "x"]);
      expect(unknownAction.exitStatus).toBe("failed");

      const missingGrow = await expectEnvelope(fixture, ["status"]);
      expect(missingGrow.exitStatus).toBe("failed");
    });
  });
});
