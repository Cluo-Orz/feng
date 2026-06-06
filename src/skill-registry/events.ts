import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";
import type { SkillRef } from "../domain/index.js";

export const skillCatalogStream: LedgerStream = {
  streamType: "skill",
  streamId: makeLedgerStreamId("skill-catalog")
};

export function skillStream(skillRef: SkillRef): LedgerStream {
  return { streamType: "skill", streamId: makeLedgerStreamId(skillRef.id) };
}

export const skillEventTypes = {
  discovered: "skill_discovered",
  registered: "skill_registered",
  versionAdded: "skill_version_added",
  activationChanged: "skill_activation_changed",
  versionPinned: "skill_version_pinned",
  disabled: "skill_disabled",
  rollbackRecorded: "skill_rollback_recorded",
  versionRetracted: "skill_version_retracted",
  bodyRefUpdated: "skill_body_ref_updated",
  defaultFeedbackRouterVersionChanged: "default_feedback_router_version_changed"
} as const;
