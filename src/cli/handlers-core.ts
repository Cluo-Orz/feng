import type { Result } from "../domain/result.js";
import { ok } from "../domain/result.js";
import { cliErr } from "./errors.js";
import { runGrowAttempt } from "./grow-run.js";
import { cliAudit, cliSource, cliVersion, type CLIRuntime } from "./runtime.js";
import {
  feedbackRef,
  growRef,
  packetRef,
  refView,
  requireValue,
  success
} from "./support.js";
import type { CLIExecutionContext, CLIHandlerResult } from "./types.js";

type Handler = (runtime: CLIRuntime, ctx: CLIExecutionContext) => Promise<Result<CLIHandlerResult>>;

export const workspaceHandler: Handler = async (runtime, ctx) => {
  const snapshot = await runtime.ports.growUnitManager.openGrowUnit(ctx.workspace);
  if (!snapshot.ok) {
    if (snapshot.error.code === "not_found") {
      return ok(success(`workspace ${ctx.workspace.id} has no grow unit`, {
        facts: ["create one with: feng grow create --title <t> --goal <g> --target <b>"]
      }));
    }
    return snapshot;
  }
  const record = snapshot.value.record;
  return ok(success(`workspace ${ctx.workspace.id} grow unit ${record.lifecycle}`, {
    facts: [`title: ${record.title}`, `phase: ${record.currentPhase}`, `events: ${snapshot.value.eventCount}`],
    refs: [refView("grow_unit", record.growUnitRef)],
    data: { snapshot: snapshot.value }
  }));
};

export const growHandler: Handler = async (runtime, ctx) => {
  const intent = ctx.intent;
  const manager = runtime.ports.growUnitManager;
  if (intent.action === "create") {
    const title = requireValue(intent, "title", 0, "title");
    if (!title.ok) return title;
    const created = await manager.createGrowUnit({
      title: title.value,
      goalBoundarySummary: intent.flags["goal"] ?? title.value,
      targetBehaviorSummary: intent.flags["target"] ?? title.value,
      source: cliSource(runtime, ctx.workspace.id),
      version: cliVersion,
      audit: cliAudit(runtime, "create grow unit via cli")
    });
    if (!created.ok) return created;
    return ok(success("grow unit created", { refs: [refView("grow_unit", created.value)] }));
  }
  if (intent.action === "list" || intent.action === "default") {
    const page = await manager.listGrowUnits({ includeArchived: intent.flags["all"] === "true" });
    if (!page.ok) return page;
    return ok(success(`${page.value.total} grow unit(s)`, {
      refs: page.value.records.map((record) => refView("grow_unit", record.growUnitRef)),
      data: { total: page.value.total, truncated: page.value.truncated }
    }));
  }
  const ref = requireValue(intent, "grow", 0, "grow unit ref");
  if (!ref.ok) return ref;
  if (intent.action === "explain") {
    const explanation = await manager.explainGrowUnitState(growRef(ref.value));
    if (!explanation.ok) return explanation;
    return ok(success("grow unit explanation", { data: { explanation: explanation.value } }));
  }
  if (intent.action === "show") {
    const record = await manager.getGrowUnit(growRef(ref.value));
    if (!record.ok) return record;
    return ok(success(`grow unit ${record.value.lifecycle}`, {
      facts: [`title: ${record.value.title}`, `phase: ${record.value.currentPhase}`],
      refs: [refView("grow_unit", record.value.growUnitRef)],
      data: { record: record.value }
    }));
  }
  if (intent.action === "run") {
    return runGrowAttempt(runtime, ctx, ref.value);
  }
  return cliErr({ code: "invalid_input", message: `unknown grow action: ${intent.action}`, severity: "warning" });
};

export const inputHandler: Handler = async (runtime, ctx) => {
  const intent = ctx.intent;
  const grow = requireValue(intent, "grow", -1, "grow unit ref");
  if (!grow.ok) return grow;
  const inbox = runtime.ports.admissionInbox;
  if (intent.action === "list") {
    const page = await inbox.listPendingInbox(growRef(grow.value));
    if (!page.ok) return page;
    return ok(success(`${page.value.total} pending inbox item(s)`, {
      refs: page.value.items.map((item) => refView("inbox_item", item.inboxItemRef)),
      data: { total: page.value.total }
    }));
  }
  const text = requireValue(intent, "text", 0, "input text");
  if (!text.ok) return text;
  const received = await inbox.receiveUserInput(growRef(grow.value), {
    content: text.value,
    ...(intent.flags["summary"] === undefined ? {} : { normalizedSummary: intent.flags["summary"] }),
    mediaType: "text/plain",
    encoding: "utf8",
    privacyClass: "contains_user_content",
    version: cliVersion,
    source: cliSource(runtime, ctx.workspace.id),
    audit: cliAudit(runtime, "submit user input via cli")
  });
  if (!received.ok) return received;
  if (intent.flags["admit"] !== "true") {
    return ok(success("user input received into inbox", {
      refs: [refView("inbox_item", received.value)],
      nextActions: [{ kind: "run_command", summary: "admit so it becomes visible context", command: "feng input submit --grow <ref> --text <t> --admit" }]
    }));
  }
  const admitted = await admitInboxItem(runtime, ctx, received.value);
  if (!admitted.ok) return admitted;
  return ok(success("user input admitted as material (visible to next grow attempt)", {
    refs: [refView("inbox_item", received.value)]
  }));
};

async function admitInboxItem(
  runtime: CLIRuntime,
  ctx: CLIExecutionContext,
  inboxItemRef: import("../admission-feedback-inbox/index.js").InboxItemRef
): Promise<Result<unknown>> {
  const inbox = runtime.ports.admissionInbox;
  const normalized = await inbox.normalizeInboxItem(inboxItemRef);
  if (!normalized.ok) return normalized;
  const classified = await inbox.classifyInboxItem(inboxItemRef);
  if (!classified.ok) return classified;
  return inbox.decideAdmission(inboxItemRef, {
    decision: "admit_as_material",
    reason: "admit user input as visible material via cli",
    source: cliSource(runtime, ctx.workspace.id),
    audit: cliAudit(runtime, "admit inbox item via cli")
  });
}

export const statusHandler: Handler = async (runtime, ctx) => {
  const grow = requireValue(ctx.intent, "grow", 0, "grow unit ref");
  if (!grow.ok) return grow;
  const ref = growRef(grow.value);
  const warnings: string[] = [];
  const admission = await runtime.ports.admissionInbox.buildAdmissionSummary(ref);
  if (!admission.ok) warnings.push(`admission summary unavailable: ${admission.error.code}`);
  const agenda = await runtime.ports.agendaManager.buildAgendaSummary(ref);
  if (!agenda.ok) warnings.push(`agenda summary unavailable: ${agenda.error.code}`);
  const readiness = await runtime.ports.evidenceReadiness.buildReadinessSummary(ref);
  if (!readiness.ok) warnings.push(`readiness summary unavailable: ${readiness.error.code}`);
  const facts: string[] = [];
  if (admission.ok) facts.push(`pending inbox: ${admission.value.pendingInboxCount}`);
  if (agenda.ok) facts.push(`open gaps: ${agenda.value.openGapCount}`);
  if (readiness.ok) facts.push(`ready to hatch: ${readiness.value.readyToHatch}`);
  return ok(success("grow unit status", {
    facts,
    warnings,
    data: {
      ...(admission.ok ? { admission: admission.value } : {}),
      ...(agenda.ok ? { agenda: agenda.value } : {}),
      ...(readiness.ok ? { readiness: readiness.value } : {})
    }
  }));
};

export const explainHandler: Handler = async (runtime, ctx) => {
  const grow = requireValue(ctx.intent, "grow", 0, "grow unit ref");
  if (!grow.ok) return grow;
  const explanation = await runtime.ports.growUnitManager.explainGrowUnitState(growRef(grow.value));
  if (!explanation.ok) return explanation;
  return ok(success("grow unit explanation", { data: { explanation: explanation.value } }));
};

export const feedbackHandler: Handler = async (runtime, ctx) => {
  const intent = ctx.intent;
  if (intent.action === "submit-candidate") {
    const packet = requireValue(intent, "packet", 0, "bridge packet ref");
    if (!packet.ok) return packet;
    const submitted = await runtime.ports.debugFeedbackBridge.submitFeedbackCandidate(packetRef(packet.value));
    if (!submitted.ok) return submitted;
    return ok(success(`feedback candidate ${submitted.value.status}`, {
      facts: ["candidate routed through Admission, not created directly by cli"],
      data: { packet: submitted.value }
    }));
  }
  if (intent.action === "explain") {
    const feedback = requireValue(intent, "feedback", 0, "feedback unit ref");
    if (!feedback.ok) return feedback;
    const explanation = await runtime.ports.admissionInbox.explainAdmissionDecision(feedbackRef(feedback.value));
    if (!explanation.ok) return explanation;
    return ok(success("feedback explanation", { data: { explanation: explanation.value } }));
  }
  const grow = requireValue(intent, "grow", 0, "grow unit ref");
  if (!grow.ok) return grow;
  const page = await runtime.ports.admissionInbox.listFeedback(growRef(grow.value));
  if (!page.ok) return page;
  return ok(success(`${page.value.total} feedback unit(s)`, {
    refs: page.value.records.map((record) => refView("feedback_unit", record.feedbackUnitRef)),
    data: { total: page.value.total }
  }));
};
