import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowHatchPublish,
  hatchInput,
  lockedContractSetup,
  makeHatchFixture
} from "./helpers.js";

describe("Hatch Builder package lifecycle", () => {
  test("prevents package version conflicts and supports supersede and retract", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);

      const emptyPage = await fixture.hatch.listHatchPackages(setup.value.growUnitRef);
      expect(emptyPage.ok).toBe(true);
      if (emptyPage.ok) {
        expect(emptyPage.value.records).toHaveLength(0);
        expect(emptyPage.value.truncated).toBe(false);
      }

      const first = await buildPackage(fixture, hatchInput(fixture, setup.value));
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(first.error.message);

      const duplicateRequest = await fixture.hatch.requestHatch(hatchInput(fixture, setup.value));
      expect(duplicateRequest.ok).toBe(true);
      if (!duplicateRequest.ok) throw new Error(duplicateRequest.error.message);
      const duplicatePlan = await fixture.hatch.buildHatchPlan(duplicateRequest.value, allowHatchPublish());
      expect(duplicatePlan.ok).toBe(false);
      if (!duplicatePlan.ok) expect(duplicatePlan.error.code).toBe("package_version_conflict");

      const second = await buildPackage(fixture, hatchInput(fixture, setup.value, {
        requestedVersion: { schemaVersion: "1.0.1", producerVersion: "hatch-test" },
        rollbackTarget: first.value
      }));
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(second.error.message);
      const superseded = await fixture.hatch.supersedeHatchPackage(first.value, second.value, "newer local package");
      expect(superseded.ok).toBe(true);
      if (superseded.ok) expect(superseded.value.to).toBe("superseded");
      const retracted = await fixture.hatch.retractHatchPackage(second.value, "bad package");
      expect(retracted.ok).toBe(true);
      if (retracted.ok) expect(retracted.value.to).toBe("retracted");

      const page = await fixture.hatch.listHatchPackages(setup.value.growUnitRef, { lifecycle: "retracted" });
      expect(page.ok).toBe(true);
      if (page.ok) expect(page.value.records).toHaveLength(1);

      const firstPage = await fixture.hatch.listHatchPackages(setup.value.growUnitRef, { limit: 1 });
      expect(firstPage.ok).toBe(true);
      if (!firstPage.ok) throw new Error(firstPage.error.message);
      expect(firstPage.value.records).toHaveLength(1);
      expect(firstPage.value.truncated).toBe(true);
      expect(firstPage.value.nextCursor).toBe("1");
      if (firstPage.value.nextCursor === undefined) throw new Error("expected next cursor");
      const secondPage = await fixture.hatch.listHatchPackages(setup.value.growUnitRef, {
        cursor: firstPage.value.nextCursor,
        limit: 1
      });
      expect(secondPage.ok).toBe(true);
      if (secondPage.ok) {
        expect(secondPage.value.records).toHaveLength(1);
        expect(secondPage.value.truncated).toBe(false);
      }
    });
  });
});

async function buildPackage(fixture: ReturnType<typeof makeHatchFixture>, input: Parameters<typeof fixture.hatch.requestHatch>[0]) {
  const request = await fixture.hatch.requestHatch(input);
  if (!request.ok) return request;
  const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
  if (!plan.ok) return plan;
  return fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
}
