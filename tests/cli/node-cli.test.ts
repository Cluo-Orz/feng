import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { createFengCli, cliInvocationIndexPath, makeCLIInvocationId } from "../../src/cli/index.js";
import { makeCliFixture, expectEnvelope } from "./helpers.js";

describe("cli node entrypoint", () => {
  it("returns a detached envelope for parse errors without persisting", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const unknown = await expectEnvelope(fixture, ["frobnicate"]);
      expect(unknown.exitStatus).toBe("failed");
      const empty = await expectEnvelope(fixture, []);
      expect(empty.exitStatus).toBe("failed");
    });
  });

  it("returns a detached envelope when the workspace cannot be opened", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const broken = createFengCli({ ports: fixture.ports, producer: "cli-test" }, "F:\\feng-nonexistent-cli-root");
      const result = await broken.run(["grow", "list"]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.exitStatus).not.toBe("succeeded");
    });
  });

  it("renders machine readable output for json display", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const envelope = await expectEnvelope(fixture, ["grow", "list", "--json"]);
      expect(envelope.displayMode).toBe("json");
      expect(JSON.parse(envelope.rendered).family).toBe("grow");
    });
  });

  it("reports a missing invocation receipt", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const receipt = await fixture.cli.getInvocationReceipt(makeCLIInvocationId("cli-invocation-missing"));
      expect(receipt.ok).toBe(false);
      if (!receipt.ok) expect(receipt.error.code).toBe("not_found");
    });
  });

  it("propagates storage corruption when persisting invocations", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      await expectEnvelope(fixture, ["grow", "list"]);
      const corrupt = await fixture.store.writeTextAtomic(fixture.workspace, cliInvocationIndexPath, "{bad", {
        reason: "corrupt cli index",
        createParents: true
      });
      expect(corrupt.ok).toBe(true);
      const result = await fixture.cli.run(["grow", "list"]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("schema_incompatible");
      const listed = await fixture.cli.listInvocations();
      expect(listed.ok).toBe(false);
    });
  });
});
