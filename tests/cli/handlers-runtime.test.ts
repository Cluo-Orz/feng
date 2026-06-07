import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  evidence,
  makeGrow,
  observe,
  runtimeArtifacts,
  setupCorrelation,
  allowAll,
  audit,
  source
} from "../debug-feedback-bridge/helpers.js";
import { makeCliFixture, expectEnvelope } from "./helpers.js";

describe("cli runtime handlers", () => {
  it("lists attempts and reports missing attempts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const list = await expectEnvelope(fixture, ["attempt", "list"]);
      expect(list.exitStatus).toBe("succeeded");
      expect(list.data?.["total"]).toBe(0);

      const explain = await expectEnvelope(fixture, ["attempt", "explain", "--attempt", "missing"]);
      expect(explain.exitStatus).toBe("failed");

      const show = await expectEnvelope(fixture, ["attempt", "show", "--attempt", "missing"]);
      expect(show.exitStatus).toBe("failed");
    });
  });

  it("builds readiness summaries and evidence listings", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const grow = await makeGrow(fixture, "readiness-grow");
      if (!grow.ok) throw new Error(grow.error.message);
      const growId = grow.value.id;

      const readiness = await expectEnvelope(fixture, ["readiness", "--grow", growId]);
      expect(["blocked_by_readiness", "succeeded"]).toContain(readiness.exitStatus);

      const ev = await expectEnvelope(fixture, ["readiness", "evidence", "--grow", growId]);
      expect(ev.exitStatus).toBe("succeeded");
    });
  });

  it("describes policy boundaries and reports unknown decisions", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const describe = await expectEnvelope(fixture, ["policy", "describe", "--capability", "feedback.upstream"]);
      expect(describe.exitStatus).toBe("succeeded");
      expect(describe.data?.["boundary"]).toBeDefined();

      const explain = await expectEnvelope(fixture, ["policy", "explain", "--decision", "missing-decision"]);
      expect(explain.exitStatus).toBe("failed");
    });
  });

  it("resolves artifact metadata and reports missing artifacts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const artifact = await evidence(fixture, "diagnostic content", "workspace_private");

      const show = await expectEnvelope(fixture, ["artifact", "show", "--artifact", artifact.id]);
      expect(show.exitStatus).toBe("succeeded");
      expect(show.facts.join(" ")).toContain("privacy");

      const missing = await expectEnvelope(fixture, ["artifact", "show", "--artifact", "nope"]);
      expect(missing.exitStatus).toBe("failed");
    });
  });

  it("lists skills and reports missing skills", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const list = await expectEnvelope(fixture, ["skill", "list"]);
      expect(list.exitStatus).toBe("succeeded");

      const show = await expectEnvelope(fixture, ["skill", "show", "--skill", "missing"]);
      expect(show.exitStatus).toBe("failed");
    });
  });

  it("explains runtime invocations, debug correlations and bridge packets", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);

      const runtime = await runtimeArtifacts(fixture, setup.value);
      if (!runtime.ok) throw new Error(runtime.error.message);

      const explain = await expectEnvelope(fixture, ["runtime", "explain", "--invocation", runtime.value.invocationRef.id]);
      expect(explain.exitStatus).toBe("succeeded");

      const hints = await expectEnvelope(fixture, ["runtime", "hints", "--invocation", runtime.value.invocationRef.id]);
      expect(hints.exitStatus).toBe("succeeded");

      const show = await expectEnvelope(fixture, ["debug", "show", "--correlation", setup.value.correlationRef.id]);
      expect(show.exitStatus).toBe("succeeded");

      const list = await expectEnvelope(fixture, ["debug", "list", "--correlation", setup.value.correlationRef.id]);
      expect(list.exitStatus).toBe("succeeded");

      const hatchShow = await expectEnvelope(fixture, ["hatch", "show", "--package", setup.value.hatchPackageRef.id]);
      expect(hatchShow.exitStatus).toBe("succeeded");

      const hatchExplain = await expectEnvelope(fixture, ["hatch", "explain", "--package", setup.value.hatchPackageRef.id]);
      expect(hatchExplain.exitStatus).toBe("succeeded");
    });
  });

  it("submits feedback candidates and explains bridge packets through admission", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeCliFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const obs = await observe(fixture, setup.value.correlationRef, { summary: "runtime acted oddly" });
      if (!obs.ok) throw new Error(obs.error.message);
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: [obs.value],
        summary: "local report attributing a context gap",
        impact: "context_gap",
        candidateTargetLayer: "current_project",
        intent: "local",
        policyContext: allowAll(),
        source: source(fixture, "system"),
        audit: audit("build packet")
      });
      if (!packet.ok) throw new Error(packet.error.message);

      const explain = await expectEnvelope(fixture, ["debug", "explain", "--packet", packet.value.id]);
      expect(explain.exitStatus).toBe("succeeded");

      const submit = await expectEnvelope(fixture, ["feedback", "submit-candidate", "--packet", packet.value.id]);
      expect(submit.exitStatus).toBe("succeeded");

      const hatchList = await expectEnvelope(fixture, ["hatch", "list", "--grow", setup.value.originGrowUnitRef.id]);
      expect(hatchList.exitStatus).toBe("succeeded");
    });
  });
});
