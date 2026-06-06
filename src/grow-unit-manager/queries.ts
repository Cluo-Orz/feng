import { ok, type Result } from "../domain/result.js";
import type { WorkspaceHandle } from "../file-store/index.js";
import { growUnitStream } from "./events.js";
import { growUnitErr } from "./errors.js";
import { lifecycleFact, matchesListQuery, snapshot } from "./logic.js";
import { projectGrowUnitEvents } from "./projection.js";
import { GrowUnitStorage } from "./storage.js";
import { skillScopeForGrowUnit } from "./types.js";
import type {
  ActiveSkillScopeSummary,
  GrowUnitListPage,
  GrowUnitListQuery,
  GrowUnitManagerOptions,
  GrowUnitRecord,
  GrowUnitStateExplanation,
  GrowUnitStateSnapshot,
  GrowUnitSnapshotOptions
} from "./types.js";

export class GrowUnitQueries {
  constructor(
    private readonly storage: GrowUnitStorage,
    private readonly options: GrowUnitManagerOptions
  ) {}

  async openGrowUnit(workspace: WorkspaceHandle): Promise<Result<GrowUnitStateSnapshot>> {
    if (workspace.id !== this.options.workspace.id) {
      return growUnitErr({ code: "invalid_input", message: "workspace does not match manager workspace" });
    }
    const listed = await this.listGrowUnits({ includeArchived: false, limit: 1 });
    if (!listed.ok) return listed;
    const ref = listed.value.records[0]?.growUnitRef;
    return ref === undefined
      ? growUnitErr({ code: "not_found", message: "no grow unit exists in workspace" })
      : this.buildGrowUnitSnapshot(ref, { reason: "open grow unit", includeActiveSkills: true });
  }

  async getGrowUnit(growUnitRef: GrowUnitRecord["growUnitRef"]): Promise<Result<GrowUnitRecord>> {
    const record = await this.storage.readRecord(growUnitRef);
    if (record.ok || record.error.code !== "not_found") return record;
    const rebuilt = await this.rebuildFromStream(growUnitRef);
    return rebuilt.ok ? ok(rebuilt.value.record) : rebuilt;
  }

  async buildGrowUnitSnapshot(
    growUnitRef: GrowUnitRecord["growUnitRef"],
    options: GrowUnitSnapshotOptions
  ): Promise<Result<GrowUnitStateSnapshot>> {
    const rebuilt = await this.rebuildFromStream(growUnitRef);
    if (!rebuilt.ok) return rebuilt;
    if (options.includeActiveSkills === false) return ok(rebuilt.value);
    const skills = await this.activeSkillSummaries(rebuilt.value.record);
    return skills.ok ? ok({ ...rebuilt.value, activeSkillSummaries: skills.value }) : skills;
  }

  async explainGrowUnitState(growUnitRef: GrowUnitRecord["growUnitRef"]): Promise<Result<GrowUnitStateExplanation>> {
    const snap = await this.buildGrowUnitSnapshot(growUnitRef, { reason: "explain grow unit", includeActiveSkills: true });
    if (!snap.ok) return snap;
    const facts = [
      lifecycleFact(snap.value.record),
      `activeRefs=${snap.value.activeRefs.length}`,
      `activeSkills=${snap.value.activeSkillSummaries.length}`,
      snap.value.record.latestReadinessVerdictRef === undefined
        ? "ready_to_hatch evidence absent"
        : "readiness verdict linked"
    ];
    return ok({
      growUnitRef,
      lifecycle: snap.value.record.lifecycle,
      summary: `${snap.value.record.title}: ${snap.value.record.goalBoundarySummary}`,
      facts,
      eventCount: snap.value.eventCount,
      ...(snap.value.lastSequence === undefined ? {} : { lastSequence: snap.value.lastSequence })
    });
  }

  async listGrowUnits(query: GrowUnitListQuery = {}): Promise<Result<GrowUnitListPage>> {
    const records = await this.storage.readAllRecords();
    if (!records.ok) return records;
    const filtered = records.value
      .filter((record) => matchesListQuery(record, query))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const start = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10);
    const limit = query.limit ?? 50;
    const page = filtered.slice(start, start + limit);
    const next = start + page.length;
    return ok({
      records: page,
      total: filtered.length,
      ...(next < filtered.length ? { nextCursor: String(next) } : {}),
      truncated: next < filtered.length
    });
  }

  private async rebuildFromStream(growUnitRef: GrowUnitRecord["growUnitRef"]): Promise<Result<GrowUnitStateSnapshot>> {
    const replay = await this.options.ledger.replayStream(growUnitStream(growUnitRef), { reason: "rebuild grow unit" });
    if (!replay.ok) return replay;
    const projected = await projectGrowUnitEvents(replay.value.events);
    if (!projected.ok) return projected;
    await this.storage.writeRecord(projected.value, "persist rebuilt grow unit projection");
    await this.storage.addToIndex(projected.value.growUnitRef);
    return ok(snapshot(projected.value, replay.value.events.length, replay.value.events.at(-1)?.sequence, [], false));
  }

  private async activeSkillSummaries(record: GrowUnitRecord): Promise<Result<readonly ActiveSkillScopeSummary[]>> {
    const scopes = [skillScopeForGrowUnit(record), { workspace: record.workspace }];
    const byRef = new Map<string, ActiveSkillScopeSummary>();
    for (const scope of scopes) {
      const active = await this.options.skillRegistry.listActiveSkills(scope);
      if (!active.ok) return active;
      for (const item of active.value.skills) {
        byRef.set(item.record.skillRef.id, {
          skillRef: item.record.skillRef,
          name: item.record.name,
          family: item.record.family,
          version: item.record.version,
          sourceKind: item.record.sourceKind
        });
      }
    }
    return ok([...byRef.values()]);
  }
}
