import { describe, expect, test } from "vitest";
import {
  buildPlanRef,
  hatchBuildPlanIndexPath,
  hatchBuildPlanPath,
  hatchPackageIndexPath,
  hatchPackagePath,
  HatchBuilderStorage,
  makeHatchBuildPlanId,
  makeHatchPackageRef,
  makeHatchRequestId,
  makeHatchVerificationId,
  parseJson,
  requestRef,
  verificationRef
} from "../../src/hatch-builder/index.js";
import { withWorkspace } from "../file-store/helpers.js";

describe("Hatch Builder storage", () => {
  test("surfaces invalid package indexes and records while tolerating missing indexed records", async () => {
    await withWorkspace(async (workspace) => {
      const storage = new HatchBuilderStorage(workspace.store, workspace.workspace);
      const invalid = await workspace.store.writeTextAtomic(workspace.workspace, hatchPackageIndexPath, "{", {
        reason: "invalid hatch package index",
        createParents: true
      });
      expect(invalid.ok).toBe(true);
      const invalidRead = await storage.readAllPackages();
      expect(invalidRead.ok).toBe(false);
      if (!invalidRead.ok) expect(invalidRead.error.code).toBe("schema_incompatible");

      const missingRef = makeHatchPackageRef("hatch-package-missing");
      const missingIndex = await workspace.store.writeTextAtomic(workspace.workspace, hatchPackageIndexPath, JSON.stringify({
        refs: [missingRef]
      }), {
        reason: "missing hatch package record",
        createParents: true
      });
      expect(missingIndex.ok).toBe(true);
      const missingRead = await storage.readAllPackages();
      expect(missingRead.ok).toBe(true);
      if (missingRead.ok) expect(missingRead.value).toHaveLength(0);

      const badRef = makeHatchPackageRef("hatch-package-bad");
      await workspace.store.writeTextAtomic(workspace.workspace, hatchPackageIndexPath, JSON.stringify({ refs: [badRef] }), {
        reason: "bad hatch package index",
        createParents: true
      });
      await workspace.store.writeTextAtomic(workspace.workspace, hatchPackagePath(badRef.id), "{", {
        reason: "bad hatch package record",
        createParents: true
      });
      const badRead = await storage.readAllPackages();
      expect(badRead.ok).toBe(false);
      if (!badRead.ok) expect(badRead.error.code).toBe("schema_incompatible");

      expect(parseJson("{", "bad json").ok).toBe(false);

      const missingVerification = await storage.readVerification(verificationRef(makeHatchVerificationId("hatch-verification-missing")));
      expect(missingVerification.ok).toBe(false);
      if (!missingVerification.ok) expect(missingVerification.error.code).toBe("not_found");

      const badPlan = buildPlanRef(makeHatchBuildPlanId("hatch-build-plan-bad"));
      await workspace.store.writeTextAtomic(workspace.workspace, hatchBuildPlanIndexPath, JSON.stringify({ refs: [badPlan] }), {
        reason: "bad hatch build plan index",
        createParents: true
      });
      await workspace.store.writeTextAtomic(workspace.workspace, hatchBuildPlanPath(badPlan.id), "{", {
        reason: "bad hatch build plan record",
        createParents: true
      });
      const plans = await storage.readAllBuildPlans();
      expect(plans.ok).toBe(false);
      if (!plans.ok) expect(plans.error.code).toBe("schema_incompatible");

      const duplicateRef = makeHatchPackageRef("hatch-package-duplicate");
      const firstAdd = await storage.addPackage(duplicateRef);
      expect(firstAdd.ok).toBe(true);
      const secondAdd = await storage.addPackage(duplicateRef);
      expect(secondAdd.ok).toBe(true);
      const indexRead = await workspace.store.readText(workspace.workspace, hatchPackageIndexPath, {
        reason: "read duplicate package index",
        maxBytes: 4096
      });
      expect(indexRead.ok).toBe(true);
      if (indexRead.ok) {
        const parsed = JSON.parse(indexRead.value.content) as { refs: Array<{ id: string }> };
        expect(parsed.refs.filter((item) => item.id === "hatch-package-duplicate")).toHaveLength(1);
      }

      const duplicateRequest = requestRef(makeHatchRequestId("hatch-request-duplicate"));
      await storage.addRequest(duplicateRequest);
      await storage.addRequest(duplicateRequest);
      const duplicatePlan = buildPlanRef(makeHatchBuildPlanId("hatch-build-plan-duplicate"));
      await storage.addBuildPlan(duplicatePlan);
      await storage.addBuildPlan(duplicatePlan);
      const requestIndex = await workspace.store.readText(workspace.workspace, ".feng/hatch-builder/requests/index.json", {
        reason: "read request index",
        maxBytes: 4096
      });
      const planIndex = await workspace.store.readText(workspace.workspace, hatchBuildPlanIndexPath, {
        reason: "read plan index",
        maxBytes: 4096
      });
      expect(requestIndex.ok && planIndex.ok).toBe(true);

      await workspace.store.writeTextAtomic(workspace.workspace, ".feng/hatch-builder/requests/index.json", "{", {
        reason: "corrupt request index",
        createParents: true
      });
      const addBadRequest = await storage.addRequest(requestRef(makeHatchRequestId("hatch-request-bad-index")));
      expect(addBadRequest.ok).toBe(false);
      if (!addBadRequest.ok) expect(addBadRequest.error.code).toBe("schema_incompatible");

      await workspace.store.writeTextAtomic(workspace.workspace, hatchBuildPlanIndexPath, "{", {
        reason: "corrupt plan index",
        createParents: true
      });
      const addBadPlan = await storage.addBuildPlan(buildPlanRef(makeHatchBuildPlanId("hatch-build-plan-bad-index")));
      expect(addBadPlan.ok).toBe(false);
      if (!addBadPlan.ok) expect(addBadPlan.error.code).toBe("schema_incompatible");
      const readBadPlans = await storage.readAllBuildPlans();
      expect(readBadPlans.ok).toBe(false);

      await workspace.store.writeTextAtomic(workspace.workspace, hatchPackageIndexPath, "{", {
        reason: "corrupt package index",
        createParents: true
      });
      const addBadPackage = await storage.addPackage(makeHatchPackageRef("hatch-package-bad-index"));
      expect(addBadPackage.ok).toBe(false);
      if (!addBadPackage.ok) expect(addBadPackage.error.code).toBe("schema_incompatible");
    });
  });
});
