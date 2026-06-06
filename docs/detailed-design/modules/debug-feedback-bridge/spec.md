# Debug & Feedback Bridge Spec

本文是 `Debug & Feedback Bridge` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Debug & Feedback Bridge` 是 hatch runtime、目标世界调试信号和上游 grow 之间的反馈桥接层。

它读取 runtime trace、debug signal、feedback hint、失败映射和人工调试观察，按 Runtime Contract、Feedback Contract、Policy 和默认反馈路由协议生成可审计的反馈候选，并通过 Admission & Feedback Inbox 创建 feedback unit 或 upstream proposal。

它不是调试 UI，不运行 agent，不判断 readiness，不采纳反馈，也不直接修改上游 grow。

## 职责

该模块负责：

```text
建立 DebugCorrelation。
关联 runtime invocation、hatch package、runtime contract、target world 和 grow unit。
读取 runtime trace artifact。
读取 TargetDebugSignal。
读取 RuntimeFeedbackCandidateHint。
读取 failure mapping 和 validation report summary。
接收人工调试观察 summary。
按 DebugContract 和 FeedbackContract 归一化调试输入。
应用 feedback router protocol 或 default_feedback_router summary。
生成 FeedbackAttribution。
生成 PrivacyFilterResult。
生成 FeedbackBridgePacket。
为 debug trace upload、feedback upstream 和跨层传播请求 PolicyDecision。
通过 Admission & Feedback Inbox 创建 feedback candidate。
通过 Admission & Feedback Inbox 请求 upstream proposal。
记录 bridge 事件。
解释一次反馈候选从哪里来、为什么只停留本地或为什么被提议上游。
```

该模块不负责：

```text
启动或运行 Agent Runtime Kernel。
实现目标世界 adapter。
执行目标世界动作。
编译 runtime message list。
编译 grow compiled_message_list。
执行工具。
维护 FeedbackUnit 状态机。
决定 accepted_local 或 accepted_upstream。
修改 grow lifecycle。
修改 Agenda、DoD 或 ReadinessVerdict。
构建 hatch package。
更新已发布 package。
上传原始私有内容到上游。
执行任意 skill body。
```

## 依赖关系

```text
Depends on:
  Domain Model & Contracts
  File-Native Store
  Event Ledger & Projection
  Artifact Registry
  Policy & Capability Boundary
  Skill Registry
  Admission & Feedback Inbox
  Runtime Contract Registry
  Hatch Builder
  Target World Adapter
  Agent Runtime Kernel

Used by:
  CLI
```

事实：

```text
Debug & Feedback Bridge 通过 Artifact Registry 读取 runtime_trace、validation_report、feedback_evidence、summary 和 redacted artifact。
Debug & Feedback Bridge 通过 Policy 判断 debug_trace.upload、feedback.upstream、artifact.export 和跨层传播边界。
Debug & Feedback Bridge 通过 Runtime Contract Registry 读取 DebugContract 和 FeedbackContract summary。
Debug & Feedback Bridge 通过 Hatch Builder 读取 hatch package debug/feedback capability summary。
Debug & Feedback Bridge 通过 Agent Runtime Kernel 读取 runtime trace、runtime invocation explanation 和 feedback hint。
Debug & Feedback Bridge 通过 Target World Adapter 读取 TargetDebugSignal 和 failure mapping summary。
Debug & Feedback Bridge 通过 Admission & Feedback Inbox 创建 feedback candidate 和 upstream proposal。
Debug & Feedback Bridge 可以读取 Skill Registry 中 default_feedback_router 的 descriptor、version 和 summary。
Debug & Feedback Bridge 不直接写 grow 事实。
```

## Debug Correlation

DebugCorrelation 表达一次可追踪的调试关联链。

它至少包含：

```text
debugCorrelationId
originGrowUnitRef
targetGrowUnitRef
hatchPackageRef
runtimeContractRef
targetWorldRef
runtimeInvocationRefs
runtimeTraceRefs
debugSignalRefs
feedbackHintRefs
manualObservationRefs
mode
status
privacyBoundary
correlationId
causationId
createdAt
closedAt
source
audit
```

mode 至少包括：

```text
runtime_debug
developer_debug
replay_debug
feedback_reporting
upstream_proposal
manual_review
```

status 至少包括：

```text
created
collecting
normalized
waiting_policy
waiting_human
packet_built
submitted_local
proposed_upstream
local_only
rejected
closed
archived
```

事实：

```text
DebugCorrelation 不是 session。
DebugCorrelation 不改变 grow unit lifecycle。
DebugCorrelation 可以跨 runtime invocation，但必须保持同一个明确的 causation chain。
DebugCorrelation 必须记录 originGrowUnitRef 和 targetGrowUnitRef，缺失时只能产生 local_only 或 waiting_human 结果。
```

## Runtime Report Envelope

RuntimeReportEnvelope 是桥接层接收调试材料后的统一输入形态。

它至少包含：

```text
runtimeReportId
debugCorrelationRef
sourceKind
sourceRef
runtimeTraceRef
debugSignalRef
feedbackHintRef
failureMappingRef
validationReportRef
manualObservationRef
summary
evidenceRefs
privacyClass
sourceLayer
targetLayerHint
receivedAt
source
audit
```

sourceKind 至少包括：

```text
runtime_trace
target_debug_signal
runtime_feedback_hint
failure_mapping
validation_report
manual_observation
external_runtime_report
```

事实：

```text
RuntimeReportEnvelope 不等于 FeedbackUnit。
RuntimeReportEnvelope 不等于 inbox item。
RuntimeReportEnvelope 只用于桥接层归一化，不进入 grow message list。
大型内容必须通过 ArtifactRef 表达。
```

## Feedback Attribution

FeedbackAttribution 表达一个问题应该归因到哪一层。

它至少包含：

```text
attributionId
debugCorrelationRef
originLayer
candidateTargetLayer
confidence
reason
evidenceRefs
counterEvidenceRefs
sourceRefs
routerVersionRef
source
audit
```

originLayer / candidateTargetLayer 至少包括：

```text
current_project
target_agent_project
upstream_feng_project
external_runtime
target_world_adapter
runtime_kernel
feedback_router
unknown
```

confidence 至少包括：

```text
high
medium
low
unknown
```

事实：

```text
attribution 是候选判断，不是采纳结论。
unknown attribution 不能自动上游传播。
单次下游失败不能直接归因为 upstream_feng_project。
归因必须保留证据和反证引用。
```

## Privacy Filter Result

PrivacyFilterResult 表达桥接层对调试材料传播边界的判断。

它至少包含：

```text
privacyFilterId
debugCorrelationRef
inputArtifactRefs
originalPrivacyClasses
resultPrivacyClass
redactedSummaryRef
redactedEvidenceRefs
blockedRefs
policyDecisionId
decision
reason
source
audit
```

decision 至少包括：

```text
pass_local
redact_then_local
redact_then_upstream_candidate
block_upstream
block_all
waiting_policy
waiting_human
```

事实：

```text
PrivacyFilterResult 不删除原始 artifact。
redactedSummaryRef 是跨层传播默认载体。
contains_secret、project_private、contains_user_content 默认不能原文上游传播。
隐私不明时不能生成 upstream proposal request。
```

## Feedback Bridge Packet

FeedbackBridgePacket 是提交给 Admission & Feedback Inbox 的反馈候选包。

它至少包含：

```text
bridgePacketId
debugCorrelationRef
originGrowUnitRef
targetGrowUnitRef
summary
detailRef
redactedSummaryRef
evidenceRefs
runtimeTraceRefs
debugSignalRefs
attribution
impact
suggestedAction
privacyClass
policyDecisionId
routerTraceRef
contractRefs
source
audit
```

impact 至少包括：

```text
runtime_failure
quality_regression
contract_gap
adapter_gap
kernel_gap
feedback_policy_gap
context_gap
tool_gap
target_world_gap
unknown
```

suggestedAction 至少包括：

```text
keep_local_observation
create_local_feedback_candidate
request_more_evidence
request_human_review
propose_to_target_agent
propose_to_upstream_feng
reject_as_noise
quarantine
```

事实：

```text
FeedbackBridgePacket 不等于 FeedbackUnit。
FeedbackBridgePacket 不等于 accepted feedback。
FeedbackBridgePacket 必须经 Admission & Feedback Inbox 才能成为 FeedbackUnitRecord。
FeedbackBridgePacket 必须带 attribution、privacyClass、policyDecisionId 或明确 local_only reason。
```

## Upstream Proposal Request

UpstreamProposalRequest 是桥接层向 Admission & Feedback Inbox 请求创建 upstream proposal 的输入。

它至少包含：

```text
upstreamProposalRequestId
debugCorrelationRef
feedbackUnitRefs
fromGrowUnitRef
toGrowUnitRef
summary
redactedSummaryRef
evidenceRefs
policyDecisionId
attribution
reason
source
audit
```

事实：

```text
UpstreamProposalRequest 不等于 UpstreamProposal。
UpstreamProposal 只能由 Admission & Feedback Inbox 创建。
UpstreamProposal 不等于 accepted_upstream。
原始 runtime_trace 默认不进入 upstream proposal。
```

## Default Feedback Router Protocol

Default Feedback Router Protocol 是 feng 默认携带的反馈路由能力。

事实：

```text
该协议可以以 skill 的形式沉淀和随 feng 自身 grow 迭代。
该协议可以被 hatch package 携带，也可以被场景 grow 修改。
Debug & Feedback Bridge 读取协议的 descriptor、version、summary 和 compatibility。
Debug & Feedback Bridge 可以记录 routerTraceRef，说明为何建议 local_only、propose upstream 或 request evidence。
router 输出是 suggestion，不直接改变 feedback status。
router 输出不能绕过 Policy、PrivacyFilterResult 或 Admission & Feedback Inbox。
如果 router 需要 LLM、tool 或目标世界调用，本模块不直接执行该 skill body；它只记录需要更重评估的候选事实。
```

## Ports

### Correlation Port

```text
openDebugCorrelation(input) -> Result<DebugCorrelationRef>
linkRuntimeInvocation(debugCorrelationRef, runtimeInvocationRef) -> Result<BridgeReceipt>
linkRuntimeTrace(debugCorrelationRef, runtimeTraceRef) -> Result<BridgeReceipt>
linkDebugSignal(debugCorrelationRef, debugSignalRef) -> Result<BridgeReceipt>
closeDebugCorrelation(debugCorrelationRef, reason) -> Result<BridgeReceipt>
```

事实：

```text
openDebugCorrelation 不创建 session。
linkRuntimeTrace 不创建 feedback candidate。
closeDebugCorrelation 不改变 grow lifecycle。
```

### Ingest Port

```text
ingestRuntimeTrace(debugCorrelationRef, runtimeTraceRef) -> Result<RuntimeReportEnvelopeRef>
ingestTargetDebugSignal(debugCorrelationRef, debugSignalRef) -> Result<RuntimeReportEnvelopeRef>
ingestRuntimeFeedbackHint(debugCorrelationRef, feedbackHintRef) -> Result<RuntimeReportEnvelopeRef>
ingestManualObservation(debugCorrelationRef, observation) -> Result<RuntimeReportEnvelopeRef>
```

事实：

```text
ingest 只创建 RuntimeReportEnvelope。
ingest 读取 artifact metadata 和 summary，不默认读取完整私有内容。
ingest 结果不能直接进入 message list。
```

### Packet Port

```text
buildFeedbackBridgePacket(debugCorrelationRef, input) -> Result<FeedbackBridgePacketRef>
explainFeedbackBridgePacket(bridgePacketRef) -> Result<FeedbackBridgeExplanation>
listBridgePackets(debugCorrelationRef, query) -> Result<FeedbackBridgePacketPage>
```

事实：

```text
buildFeedbackBridgePacket 应用 contract、router summary、attribution 和 privacy filter。
buildFeedbackBridgePacket 不创建 FeedbackUnit。
explain 返回来源链、policy、privacy、router、归因和排除内容。
```

### Submit Port

```text
submitFeedbackCandidate(bridgePacketRef) -> Result<FeedbackUnitRef>
requestUpstreamProposal(input) -> Result<UpstreamProposalRef>
recordUpstreamBridgeResult(upstreamProposalRef, result) -> Result<BridgeReceipt>
```

事实：

```text
submitFeedbackCandidate 调用 Admission & Feedback Inbox。
submitFeedbackCandidate 创建的 feedback 默认是 candidate。
requestUpstreamProposal 调用 Admission & Feedback Inbox 的 Upstream Port。
recordUpstreamBridgeResult 只记录回执，不替上游判断 accepted_upstream。
```

### Privacy and Policy Port

```text
evaluateBridgePrivacy(debugCorrelationRef, inputRefs) -> Result<PrivacyFilterResultRef>
evaluateBridgePolicy(actionRequest) -> Result<PolicyDecision>
buildRedactedBridgeSummary(debugCorrelationRef, inputRefs) -> Result<ArtifactRef>
```

事实：

```text
evaluateBridgePolicy 不执行上报。
buildRedactedBridgeSummary 创建 summary 或 redacted artifact，不删除原始 trace。
```

## 事件

该模块写入 debug bridge 相关 stream。事件可落在 grow_unit stream、runtime_trace stream，或由 Event Ledger 在实现阶段提供 debug_bridge stream。

事件类型至少包括：

```text
debug_correlation_opened
debug_correlation_linked_runtime
debug_correlation_linked_trace
debug_correlation_linked_signal
runtime_report_envelope_created
feedback_attribution_recorded
privacy_filter_applied
feedback_bridge_packet_built
feedback_candidate_submitted
upstream_proposal_requested
upstream_bridge_result_recorded
debug_correlation_closed
bridge_decision_superseded
```

事实：

```text
事件 payload 保存 summary、Ref、status、policyDecisionId 和 correlationId，不内联大型 trace 或目标世界状态。
纠错通过 superseding event，不改写旧事件。
debug bridge stream 可重建每个 bridge packet 的来源链。
```

## 与其他模块的边界

### Agent Runtime Kernel

Agent Runtime Kernel 产生 RuntimeTrace、RuntimeInvocationExplanation 和 RuntimeFeedbackCandidateHint。

Debug & Feedback Bridge 读取这些运行事实。

事实：

```text
RuntimeFeedbackCandidateHint 不等于 FeedbackUnit。
RuntimeTrace 不等于 feedback accepted。
Debug & Feedback Bridge 不运行 RuntimeTurn。
```

### Target World Adapter

Target World Adapter 产生 TargetDebugSignal、FailureMapping 和 validation report。

Debug & Feedback Bridge 读取这些事实并形成反馈候选。

事实：

```text
DebugSignal 不等于 FeedbackUnit。
FailureMapping 的 attributionHint 不等于最终归因。
目标世界私有内容默认不上游。
```

### Runtime Contract Registry

Runtime Contract Registry 声明 DebugContract 和 FeedbackContract。

Debug & Feedback Bridge 按 contract 判断哪些 trace、debug signal 和 feedback entry 是合法候选。

事实：

```text
DebugContract 只声明接口，不上传 trace。
FeedbackContract 只声明入口，不发送反馈。
contract 兼容不等于 feedback 可上游。
```

### Admission & Feedback Inbox

Admission & Feedback Inbox 拥有 inbox item、FeedbackUnit 和 UpstreamProposal 的状态语义。

Debug & Feedback Bridge 只提交候选包和上游请求。

事实：

```text
FeedbackBridgePacket 不等于 FeedbackUnit。
candidate 不等于 accepted_local。
proposed_upstream 不等于 accepted_upstream。
Bridge 不直接改 feedback status。
```

### Policy & Capability Boundary

Policy 判断 debug_trace.upload、feedback.upstream、artifact.export 和敏感内容传播边界。

Debug & Feedback Bridge 引用 PolicyDecision 并执行脱敏约束。

事实：

```text
Policy allow upload 不等于上游吸收。
Policy deny upstream 不删除本地 bridge packet。
allow_with_redaction 必须使用 redactedSummaryRef 或 redactedEvidenceRefs。
```

### Skill Registry

Skill Registry 管理 default_feedback_router skill。

Debug & Feedback Bridge 使用其 descriptor、version、summary 和 compatibility。

事实：

```text
active feedback router 不等于反馈状态决策权。
router suggestion 不直接创建 UpstreamProposal。
router version 必须进入 routerTraceRef 或 attribution source。
```

### Hatch Builder

Hatch Builder 在 package 中携带 debug/feedback 能力 summary。

Debug & Feedback Bridge 使用该 summary 判断 runtime 是否支持调试和反馈上报。

事实：

```text
hatch package 支持 feedback 不等于默认允许上游传播。
Debug & Feedback Bridge 不修改 package。
```

## 多层闭环边界

以 `feng -> xiaoshuo -> libai-chongshengle` 为例：

```text
libai-chongshengle 运行时产生小说章节质量问题、风格漂移、设定冲突或作者观察。
Debug & Feedback Bridge 在 xiaoshuo 层把这些事实转成 xiaoshuo 的 feedback candidate。
只有被归因为 xiaoshuo 通用写作 agent 能力的问题，才可能被提议给 xiaoshuo grow。
只有被归因为 feng 默认 feedback router、runtime kernel、contract、hatch 或 file-native 机制的问题，才可能被提议给 feng grow。
具体小说正文、私有设定和项目局部偏好默认不进入 feng 上游。
```

事实：

```text
下游项目事实不自动变成上游产品事实。
领域 agent 的局部学习不自动变成 feng 的通用能力。
跨层反馈必须有 attribution、redaction、policyDecisionId 和 evidenceRefs。
```

## 不变量

```text
DebugCorrelation 不是 session。
RuntimeTrace 不等于 feedback accepted。
TargetDebugSignal 不等于 FeedbackUnit。
RuntimeFeedbackCandidateHint 不等于 FeedbackUnit。
FeedbackBridgePacket 不等于 FeedbackUnit。
FeedbackUnit 只能通过 Admission & Feedback Inbox 创建。
UpstreamProposal 只能通过 Admission & Feedback Inbox 创建。
Policy allow upload 不等于上游 accepted。
router suggestion 不等于 feedback status transition。
unknown attribution 不能自动上游传播。
目标世界私有内容默认不上游。
原始 runtime_trace 默认不上游。
所有跨层传播必须有 attribution、privacy filter 和 policy decision。
Bridge 不修改 grow lifecycle、DoD、readiness、contract 或 package。
```

## 错误行为

该模块使用 `Result<DomainError>` 表达业务失败。

错误 code 至少覆盖：

```text
not_found
invalid_input
invalid_state
permission_denied
policy_blocked
privacy_blocked
version_unsupported
schema_incompatible
artifact_unavailable
runtime_trace_unavailable
debug_contract_incompatible
feedback_contract_incompatible
attribution_insufficient
redaction_required
upstream_policy_required
admission_rejected
bridge_conflict
```

事实：

```text
缺少 runtimeContractRef 或 hatchPackageRef 时返回 invalid_input。
DebugContract 不支持当前 debug mode 时返回 debug_contract_incompatible。
FeedbackContract 不支持当前 feedback entry kind 时返回 feedback_contract_incompatible。
artifact metadata 不可用时不能执行 upstream proposal request。
隐私未明时返回 privacy_blocked、redaction_required 或 upstream_policy_required。
归因不足时返回 attribution_insufficient 或生成 request_more_evidence 建议。
Admission 拒绝候选时返回 admission_rejected 并保留 bridge 事件。
```

## 验证要求

实现阶段应验证：

```text
linkRuntimeTrace 不会创建 FeedbackUnit。
RuntimeFeedbackCandidateHint 不会绕过 Bridge 和 Admission。
DebugSignal 不会直接生成 accepted feedback。
submitFeedbackCandidate 创建的 feedback 默认是 candidate。
requestUpstreamProposal 必须经过 PolicyDecision。
contains_secret、project_private、contains_user_content 不会原文上游传播。
unknown attribution 不会创建 upstream proposal。
router suggestion 不会直接改 feedback status。
Bridge 不 import Grow Unit Manager 的 lifecycle mutation port。
Bridge 不调用 Context & Message Compiler 或 Agent Runtime Kernel 的 runRuntimeTurn。
debug bridge stream 可以重建 bridge packet 来源链。
```

## 开放问题

```text
DebugCorrelation 在 CLI 中如何展示，需要与 CLI spec 联合确认。
第一阶段是否把 default_feedback_router 限定为确定性规则，还是允许通过 grow attempt 做重评估，需要实现阶段确认。
实时游戏 boss 场景的 trace 采样和批量上报策略需要场景 adapter 设计。
redaction 的具体策略和可配置粒度属于实现阶段 policy/schema 设计。
```

这些问题不影响本模块当前终态事实：Debug & Feedback Bridge 是跨生命周期的反馈候选桥接层，不是调试 UI、feedback 状态机、上游吸收器、runtime 执行器或自我更新机制。

