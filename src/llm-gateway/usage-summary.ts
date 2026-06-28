import type { LLMUsage } from "./types.js";

export interface LLMUsageSample {
  readonly phase: string;
  readonly usage: LLMUsage;
}

export interface LLMUsagePhaseSummary {
  readonly phase: string;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
  readonly cacheHitRatePct: number;
  readonly zeroCacheReadCalls: number;
}

export interface LLMUsageSummary {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
  readonly cacheHitRatePct: number;
  readonly zeroCacheReadCalls: number;
  readonly byPhase: readonly LLMUsagePhaseSummary[];
}

function rate(cacheReadTokens: number, inputTokens: number): number {
  return inputTokens > 0 ? Math.round((cacheReadTokens * 10_000) / inputTokens) / 100 : 0;
}

function summarizeTotals(
  samples: readonly { readonly usage: LLMUsage }[]
): Omit<LLMUsagePhaseSummary, "phase"> {
  const totals = samples.reduce((acc, sample) => ({
    calls: acc.calls + 1,
    inputTokens: acc.inputTokens + sample.usage.inputTokens,
    outputTokens: acc.outputTokens + sample.usage.outputTokens,
    reasoningTokens: acc.reasoningTokens + sample.usage.reasoningTokens,
    cacheReadTokens: acc.cacheReadTokens + sample.usage.cacheReadTokens,
    cacheWriteTokens: acc.cacheWriteTokens + sample.usage.cacheWriteTokens,
    totalTokens: acc.totalTokens + sample.usage.totalTokens,
    zeroCacheReadCalls: acc.zeroCacheReadCalls + (sample.usage.cacheReadTokens === 0 ? 1 : 0)
  }), {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    zeroCacheReadCalls: 0
  });
  return {
    ...totals,
    cacheHitRatePct: rate(totals.cacheReadTokens, totals.inputTokens)
  };
}

export function summarizeLLMUsage(samples: readonly LLMUsageSample[]): LLMUsageSummary {
  const byPhase = new Map<string, LLMUsageSample[]>();
  for (const sample of samples) {
    const bucket = byPhase.get(sample.phase) ?? [];
    bucket.push(sample);
    byPhase.set(sample.phase, bucket);
  }
  return {
    ...summarizeTotals(samples),
    byPhase: [...byPhase.entries()].map(([phase, items]) => ({
      phase,
      ...summarizeTotals(items)
    }))
  };
}

export function combineLLMUsageSummaries(summaries: readonly LLMUsageSummary[]): LLMUsageSummary {
  const totals = summaries.reduce((acc, summary) => ({
    calls: acc.calls + summary.calls,
    inputTokens: acc.inputTokens + summary.inputTokens,
    outputTokens: acc.outputTokens + summary.outputTokens,
    reasoningTokens: acc.reasoningTokens + summary.reasoningTokens,
    cacheReadTokens: acc.cacheReadTokens + summary.cacheReadTokens,
    cacheWriteTokens: acc.cacheWriteTokens + summary.cacheWriteTokens,
    totalTokens: acc.totalTokens + summary.totalTokens,
    zeroCacheReadCalls: acc.zeroCacheReadCalls + summary.zeroCacheReadCalls
  }), {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    zeroCacheReadCalls: 0
  });
  const phases = new Map<string, Omit<LLMUsagePhaseSummary, "cacheHitRatePct">>();
  for (const summary of summaries) {
    for (const phase of summary.byPhase) {
      const prior = phases.get(phase.phase) ?? {
        phase: phase.phase,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        zeroCacheReadCalls: 0
      };
      phases.set(phase.phase, {
        phase: phase.phase,
        calls: prior.calls + phase.calls,
        inputTokens: prior.inputTokens + phase.inputTokens,
        outputTokens: prior.outputTokens + phase.outputTokens,
        reasoningTokens: prior.reasoningTokens + phase.reasoningTokens,
        cacheReadTokens: prior.cacheReadTokens + phase.cacheReadTokens,
        cacheWriteTokens: prior.cacheWriteTokens + phase.cacheWriteTokens,
        totalTokens: prior.totalTokens + phase.totalTokens,
        zeroCacheReadCalls: prior.zeroCacheReadCalls + phase.zeroCacheReadCalls
      });
    }
  }
  return {
    ...totals,
    cacheHitRatePct: rate(totals.cacheReadTokens, totals.inputTokens),
    byPhase: [...phases.values()].map((phase) => ({
      ...phase,
      cacheHitRatePct: rate(phase.cacheReadTokens, phase.inputTokens)
    }))
  };
}
