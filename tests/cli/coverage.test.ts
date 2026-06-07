import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { makeCliFixture, expectEnvelope, type CliFixture } from "./helpers.js";

async function failing(fixture: CliFixture, argv: readonly string[]): Promise<void> {
  const envelope = await expectEnvelope(fixture, argv);
  expect(envelope.exitStatus).toBe("failed");
}

describe("cli handler argument and error branches", () => {
  it("requires arguments across every command family", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      await failing(fixture, ["input", "submit"]);
      await failing(fixture, ["input", "list"]);
      await failing(fixture, ["status"]);
      await failing(fixture, ["explain"]);
      await failing(fixture, ["feedback", "explain"]);
      await failing(fixture, ["readiness"]);
      await failing(fixture, ["hatch", "show"]);
      await failing(fixture, ["hatch", "list"]);
      await failing(fixture, ["runtime", "explain"]);
      await failing(fixture, ["debug", "show"]);
      await failing(fixture, ["debug", "explain"]);
      await failing(fixture, ["policy", "describe"]);
      await failing(fixture, ["policy", "explain"]);
      await failing(fixture, ["artifact", "show"]);
      await failing(fixture, ["skill", "show"]);
    });
  });

  it("reports not_found for unknown references", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      await failing(fixture, ["grow", "show", "--grow", "ghost"]);
      await failing(fixture, ["feedback", "explain", "--feedback", "ghost"]);
      await failing(fixture, ["hatch", "explain", "--package", "ghost"]);
      await failing(fixture, ["runtime", "explain", "--invocation", "ghost"]);
    });
  });

  it("returns empty listings for unknown scopes", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const hints = await expectEnvelope(fixture, ["runtime", "hints", "--invocation", "ghost"]);
      expect(hints.exitStatus).toBe("succeeded");
      const packets = await expectEnvelope(fixture, ["debug", "list", "--correlation", "ghost"]);
      expect(packets.exitStatus).toBe("succeeded");
    });
  });

  it("applies the grow filter when listing attempts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const envelope = await expectEnvelope(fixture, ["attempt", "list", "--grow", "ghost"]);
      expect(envelope.exitStatus).toBe("succeeded");
      expect(envelope.data?.["total"]).toBe(0);
    });
  });
});
