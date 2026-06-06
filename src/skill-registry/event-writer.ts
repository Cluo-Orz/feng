import type { EventLedger } from "../event-ledger/index.js";
import { skillCatalogStream, skillStream } from "./events.js";
import { toSkillEventPayload } from "./payloads.js";
import type { SkillRecord } from "./types.js";

export class SkillEventWriter {
  constructor(
    private readonly ledger: EventLedger,
    private readonly producer: string
  ) {}

  async catalog(eventType: string, payload: unknown, input: { readonly source: SkillRecord["source"]; readonly reason: string }) {
    return this.ledger.appendEvent(skillCatalogStream, {
      eventType,
      eventVersion: "1",
      payload: toSkillEventPayload(payload),
      source: input.source,
      audit: { createdAt: new Date().toISOString(), createdBy: this.producer, reason: input.reason },
      producer: this.producer
    });
  }

  async skill(record: SkillRecord, eventType: string, payload: unknown) {
    return this.ledger.appendEvent(skillStream(record.skillRef), {
      eventType,
      eventVersion: "1",
      payload: toSkillEventPayload(payload),
      source: record.source,
      audit: record.audit,
      producer: this.producer
    });
  }
}
