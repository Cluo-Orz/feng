import type { AuditDescriptor, SourceDescriptor } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import { llmGatewayEventTypes, llmGatewayStream } from "./events.js";
import { llmGatewayErr } from "./errors.js";
import { payload } from "./payloads.js";
import type { LLMGatewayOptions, LLMProviderAdapter } from "./types.js";

export interface LLMGatewayRuntime {
  readonly options: LLMGatewayOptions;
  readonly adapters: ReadonlyMap<string, LLMProviderAdapter>;
}

export function createLLMGatewayRuntime(options: LLMGatewayOptions): LLMGatewayRuntime {
  return {
    options,
    adapters: new Map((options.adapters ?? []).map((adapter) => [adapter.provider, adapter]))
  };
}

export function adapterFor(runtime: LLMGatewayRuntime, provider: string): Result<LLMProviderAdapter> {
  const adapter = runtime.adapters.get(provider);
  return adapter === undefined
    ? llmGatewayErr({
        code: "provider_unavailable",
        message: `provider adapter ${provider} is not registered`,
        retryable: false
      })
    : ok(adapter);
}

export async function appendLLMEvent(input: {
  readonly runtime: LLMGatewayRuntime;
  readonly eventType: (typeof llmGatewayEventTypes)[keyof typeof llmGatewayEventTypes];
  readonly body: Record<string, unknown>;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string;
}): Promise<Result<EventAppendReceipt>> {
  return input.runtime.options.ledger.appendEvent(llmGatewayStream(input.runtime.options.workspace), {
    eventType: input.eventType,
    eventVersion: "1",
    payload: payload(input.body),
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    producer: input.runtime.options.producer
  });
}
