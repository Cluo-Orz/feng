import type { GrowUnitRef } from "../domain/index.js";
import type { FileNativeStore } from "../file-store/index.js";
import { createAgendaRecord, getAgendaRecord } from "./agenda-flow.js";
import { defineDoDRecord, linkDoDEvaluationRecord, listActiveDoDRecords, retireDoDRecord, reviseDoDRecord } from "./dod-flow.js";
import { listOpenGapRecords, recordGapRecord, resolveGapRecordForNow, updateGapRecord } from "./gap-flow.js";
import { buildAttemptIntentRecord, explainAttemptIntentRecord } from "./intent-flow.js";
import { activateAgendaItemRecord, proposeAgendaItemRecord, retireAgendaItemRecord, updateAgendaItemRecord } from "./item-flow.js";
import { createAgendaRuntime, type AgendaRuntime } from "./runtime.js";
import { buildAgendaSummaryRecord, explainAgendaStateRecord } from "./summary-flow.js";
import type {
  AgendaDoDManager,
  AgendaDoDManagerOptions,
  AgendaItemRef,
  AgendaItemUpdateInput,
  AttemptIntentRef,
  AttemptIntentOptions,
  CreateAgendaInput,
  DefineDoDInput,
  DoDRef,
  DoDRevisionInput,
  GapRef,
  GapStatus,
  GapUpdateInput,
  PageQuery,
  ProposeAgendaItemInput,
  RecordGapInput
} from "./types.js";

export function createAgendaDoDManager(store: FileNativeStore, options: AgendaDoDManagerOptions): AgendaDoDManager {
  return new NodeAgendaDoDManager(createAgendaRuntime(store, options));
}

class NodeAgendaDoDManager implements AgendaDoDManager {
  constructor(private readonly runtime: AgendaRuntime) {}

  createAgenda(growUnitRef: GrowUnitRef, input: CreateAgendaInput) {
    return createAgendaRecord(this.runtime, growUnitRef, input);
  }

  getAgenda(growUnitRef: GrowUnitRef) {
    return getAgendaRecord(this.runtime, growUnitRef);
  }

  proposeAgendaItem(growUnitRef: GrowUnitRef, input: ProposeAgendaItemInput) {
    return proposeAgendaItemRecord(this.runtime, growUnitRef, input);
  }

  activateAgendaItem(agendaItemRef: AgendaItemRef, reason: AgendaItemUpdateInput) {
    return activateAgendaItemRecord(this.runtime, agendaItemRef, reason);
  }

  updateAgendaItem(agendaItemRef: AgendaItemRef, update: AgendaItemUpdateInput) {
    return updateAgendaItemRecord(this.runtime, agendaItemRef, update);
  }

  retireAgendaItem(agendaItemRef: AgendaItemRef, reason: AgendaItemUpdateInput) {
    return retireAgendaItemRecord(this.runtime, agendaItemRef, reason);
  }

  recordGap(growUnitRef: GrowUnitRef, input: RecordGapInput) {
    return recordGapRecord(this.runtime, growUnitRef, input);
  }

  updateGap(gapRef: GapRef, update: GapUpdateInput) {
    return updateGapRecord(this.runtime, gapRef, update);
  }

  resolveGapForNow(gapRef: GapRef, reason: GapUpdateInput) {
    return resolveGapRecordForNow(this.runtime, gapRef, reason);
  }

  listOpenGaps(growUnitRef: GrowUnitRef, query?: PageQuery<GapStatus>) {
    return listOpenGapRecords(this.runtime, growUnitRef, query);
  }

  defineDoD(growUnitRef: GrowUnitRef, input: DefineDoDInput) {
    return defineDoDRecord(this.runtime, growUnitRef, input);
  }

  reviseDoD(dodRef: DoDRef, revision: DoDRevisionInput) {
    return reviseDoDRecord(this.runtime, dodRef, revision);
  }

  retireDoD(dodRef: DoDRef, reason: DoDRevisionInput) {
    return retireDoDRecord(this.runtime, dodRef, reason);
  }

  linkDoDEvaluation(dodRef: DoDRef, evaluationRef: Parameters<AgendaDoDManager["linkDoDEvaluation"]>[1], reason: DoDRevisionInput) {
    return linkDoDEvaluationRecord(this.runtime, dodRef, evaluationRef, reason);
  }

  listActiveDoD(growUnitRef: GrowUnitRef) {
    return listActiveDoDRecords(this.runtime, growUnitRef);
  }

  buildAttemptIntent(growUnitRef: GrowUnitRef, options: AttemptIntentOptions) {
    return buildAttemptIntentRecord(this.runtime, growUnitRef, options);
  }

  explainAttemptIntent(attemptIntentRef: AttemptIntentRef) {
    return explainAttemptIntentRecord(this.runtime, attemptIntentRef);
  }

  buildAgendaSummary(growUnitRef: GrowUnitRef) {
    return buildAgendaSummaryRecord(this.runtime, growUnitRef);
  }

  explainAgendaState(growUnitRef: GrowUnitRef) {
    return explainAgendaStateRecord(this.runtime, growUnitRef);
  }
}
