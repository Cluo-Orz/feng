import type { FeedbackUnitRef } from "../domain/index.js";
import type { Result } from "../domain/result.js";
import { feedbackStream } from "./events.js";
import { projectFeedbackEvents } from "./projection.js";
import type { AdmissionRuntime } from "./runtime.js";
import type { FeedbackUnitRecord } from "./types.js";

export async function readFeedbackRecord(
  runtime: AdmissionRuntime,
  ref: FeedbackUnitRef
): Promise<Result<FeedbackUnitRecord>> {
  const record = await runtime.storage.readFeedback(ref);
  if (record.ok || record.error.code !== "not_found") return record;
  const replay = await runtime.options.ledger.replayStream(feedbackStream(ref), { reason: "rebuild feedback record" });
  if (!replay.ok) return replay;
  const projected = projectFeedbackEvents(replay.value.events);
  if (!projected.ok) return projected;
  const write = await runtime.storage.writeFeedback(projected.value, "restore feedback record from event stream");
  if (!write.ok) return write;
  const index = await runtime.storage.addFeedback(projected.value.feedbackUnitRef);
  return index.ok ? projected : index;
}
