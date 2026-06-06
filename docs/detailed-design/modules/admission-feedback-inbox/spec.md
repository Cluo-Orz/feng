# Admission & Feedback Inbox Spec

本文是 `Admission & Feedback Inbox` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Admission & Feedback Inbox` 是用户输入、材料、目录事件、调试上报、runtime trace、外部事件和反馈单元的准入与状态管理层。

它保证所有输入先成为可追踪候选，再经过分类、隐私检查、证据关联、状态转换和必要的上游提议。它不直接把任何内容放进下一轮 message list，也不把反馈自动吸收到上游 grow。

## 职责

该模块负责：

```text
接收用户输入、材料、文件变化、调试上报、runtime report 和外部事件。
创建 durable inbox item。
记录输入来源、版本、隐私边界、关联 grow unit 和 correlation。
把大型输入内容注册为 artifact。
对 inbox item 做初步分类和准入状态管理。
创建 feedback unit。
维护 feedback status。
关联 feedback evidence。
记录反馈归因、建议和影响范围。
创建 upstream proposal。
在上游提议、调试上传和敏感反馈传播前取得 PolicyDecision。
记录 admission 和 feedback 事件。
提供 grow unit 可读取的 admission summary。
```

该模块不负责：

```text
message list 编译。
LLM 调用。
工具执行。
DoD 设计。
readiness 判断。
grow lifecycle 决策。
hatch 打包。
skill 执行。
长期记忆采纳。
上游 grow 的实际吸收。
artifact 内容 lifecycle。
目录扫描实现细节。
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
  Grow Unit Manager

Used by:
  Agenda & DoD Manager
  Context & Message Compiler
  Grow Attempt Runner
  Evidence & Readiness
  Hatch Builder
  Runtime Contract Registry
  Agent Runtime Kernel
  Target World Adapter
  Debug & Feedback Bridge
  CLI
```

事实：

```text
Admission 通过 Artifact Registry 保存输入附件、trace、feedback evidence 和 redacted summary。
Admission 通过 Event Ledger 写入 grow_unit 相关 admission 事件和 feedback_unit 事件。
Admission 通过 Policy 判断 feedback upstream、debug trace upload、敏感内容传播和脱敏要求。
Admission 可以读取 Skill Registry 的 default_feedback_router summary，但不执行 skill。
Admission 只向 Grow Unit Manager 提供 admission summary，不直接改 grow lifecycle。
```

## Inbox Item

InboxItemRecord 表示收到但未必准入的输入或外部事件。

InboxItemRecord 至少表达：

```text
inboxItemId
growUnitRef
sourceKind
source
receivedAt
rawArtifactRef
previewRef
normalizedSummary
initialPrivacyClass
status
correlationId
causationId
policyDecisionId
audit
```

sourceKind 至少包括：

```text
user_input
file_material
file_change
runtime_report
debug_trace
tool_result_reference
external_event
upstream_proposal
manual_review
```

Inbox item status 至少包括：

```text
received
normalized
classified
waiting_policy
waiting_evidence
waiting_human
admitted
rejected
quarantined
redacted
archived
```

事实：

```text
received 不等于 admitted。
admitted 不等于 message list 可见。
quarantined 表示需要隔离审查，不进入常规候选。
rawArtifactRef 保存原始内容引用，previewRef 保存可展示或可判断摘要。
```

## Admission Decision

AdmissionDecision 表达对 inbox item 的准入判断。

decision 至少包括：

```text
admit_as_material
admit_as_goal_signal
admit_as_feedback_candidate
reject
quarantine
wait_for_evidence
wait_for_human
redact_then_admit
propose_upstream
local_only
```

事实：

```text
decision 必须有 reason、source、audit 和 evidenceRefs。
redact_then_admit 必须引用 redacted artifact 或 redacted summary。
propose_upstream 必须先经过 PolicyDecision。
local_only 表示不允许或不适合跨层传播。
```

## Feedback Unit

FeedbackUnitRecord 表示运行问题、下游反馈、调试上报或归因建议。

FeedbackUnitRecord 至少表达：

```text
feedbackUnitId
feedbackUnitRef
growUnitRef
originLayer
targetLayer
status
summary
detailRef
evidenceRefs
runtimeTraceRefs
attribution
impact
suggestedAction
privacyClass
policyDecisionId
upstreamProposalRef
createdAt
updatedAt
source
audit
```

originLayer / targetLayer 至少能表达：

```text
current_project
target_agent_project
upstream_feng_project
external_runtime
unknown
```

Feedback status 使用 Domain Model & Contracts 的状态：

```text
candidate
accepted_local
proposed_upstream
accepted_upstream
rejected
ignored
waiting_evidence
waiting_human
redacted
```

事实：

```text
candidate 是默认状态。
accepted_local 只表示本层采纳，不表示上游吸收。
proposed_upstream 只表示已形成上游候选，不表示上游接受。
accepted_upstream 只能由上游处理结果回写。
redacted 表示传播或展示内容受限，不删除原始审计事实。
```

## Upstream Proposal

UpstreamProposal 表示向上游 grow 层提交的候选反馈包。

UpstreamProposal 至少表达：

```text
proposalId
fromGrowUnitRef
toGrowUnitRef
feedbackUnitRefs
summary
redactedSummaryRef
evidenceRefs
policyDecisionId
privacyBoundary
attribution
createdAt
source
audit
```

事实：

```text
proposal 是候选传播，不是上游采纳。
proposal 默认使用 redacted summary 或引用，不携带原始私有内容。
proposal 必须有 attribution 和 policyDecisionId。
上游是否吸收由上游 Admission/Grow 流程决定。
```

## Ports

### Receive Port

```text
receiveUserInput(growUnitRef, input) -> Result<InboxItemRef>
receiveMaterial(growUnitRef, material) -> Result<InboxItemRef>
receiveRuntimeReport(growUnitRef, report) -> Result<InboxItemRef>
receiveExternalEvent(growUnitRef, event) -> Result<InboxItemRef>
```

事实：

```text
receive 只创建 inbox item。
大型内容注册为 artifact。
receive 不改变 message list。
receive 不改变 readiness。
```

### Admission Port

```text
normalizeInboxItem(inboxItemRef) -> Result<InboxItemRecord>
classifyInboxItem(inboxItemRef, context) -> Result<AdmissionClassification>
decideAdmission(inboxItemRef, decisionInput) -> Result<AdmissionReceipt>
listPendingInbox(growUnitRef, query) -> Result<InboxItemPage>
```

事实：

```text
classification 可以使用 source、preview、privacy、grow state summary 和 default feedback router summary。
classification 不执行 LLM。
decision 写入 admission 事件。
admitted item 仍需 Context Compiler 决定是否可见。
```

### Feedback Port

```text
createFeedbackUnit(input) -> Result<FeedbackUnitRef>
transitionFeedback(feedbackUnitRef, transition) -> Result<FeedbackTransitionReceipt>
linkFeedbackEvidence(feedbackUnitRef, evidenceRefs) -> Result<FeedbackTransitionReceipt>
redactFeedback(feedbackUnitRef, policyDecisionId) -> Result<FeedbackTransitionReceipt>
listFeedback(growUnitRef, query) -> Result<FeedbackUnitPage>
```

事实：

```text
feedback status transition 写入 feedback_unit stream。
反馈证据通过 ArtifactRef 表达。
redactFeedback 不删除原始事实。
```

### Upstream Port

```text
createUpstreamProposal(feedbackUnitRefs, targetGrowUnitRef, reason) -> Result<UpstreamProposalRef>
recordUpstreamResult(proposalRef, result) -> Result<FeedbackTransitionReceipt>
```

事实：

```text
createUpstreamProposal 必须取得 PolicyDecision。
recordUpstreamResult 只记录上游返回的处理结果，不替上游做判断。
```

### Summary Port

```text
buildAdmissionSummary(growUnitRef, options) -> Result<AdmissionSummary>
explainAdmissionDecision(ref) -> Result<AdmissionExplanation>
```

事实：

```text
summary 提供给 Grow Unit Manager、Agenda、Context Compiler 和 CLI。
summary 不包含完整私有大内容。
explanation 说明某个 item 或 feedback 为什么被采纳、拒绝、等待、脱敏或上报。
```

## 事件

该模块写入 grow_unit stream 和 feedback_unit stream。

事件类型至少包括：

```text
inbox_item_received
inbox_item_normalized
inbox_item_classified
inbox_item_admitted
inbox_item_rejected
inbox_item_quarantined
inbox_item_redacted
feedback_unit_created
feedback_status_changed
feedback_evidence_linked
feedback_redacted
feedback_upstream_proposed
feedback_upstream_result_recorded
admission_decision_superseded
```

事实：

```text
事件 payload 保存 summary 和 Ref，不内联大型内容。
状态纠错通过 superseding event，不改写旧事件。
feedback_unit stream 可重建反馈状态。
```

## 与其他模块的边界

### Grow Unit Manager

Grow Unit Manager 拥有 grow lifecycle。

Admission 提供 admission summary。

事实：

```text
Admission 不直接把 grow unit 改成 growing 或 blocked。
Grow Unit Manager 不直接采纳 inbox item。
```

### Artifact Registry

Artifact Registry 保存原始材料、trace、证据、preview 和 redacted summary。

Admission 保存准入状态和反馈状态。

事实：

```text
artifact registration 不等于 admission。
artifact privacy metadata 必须参与 admission 和 upstream policy。
```

### Policy & Capability Boundary

Policy 判断反馈上报、debug trace upload、敏感内容传播和脱敏要求。

Admission 记录 policyDecisionId 并执行状态转换。

事实：

```text
Policy allow upstream 不等于上游 accepted。
Policy deny upstream 不删除本地 feedback。
```

### Skill Registry

Skill Registry 管理 default_feedback_router skill。

Admission 可以使用该 skill 的 summary 或策略引用作为分类依据。

事实：

```text
default_feedback_router 不直接改 feedback status。
default_feedback_router 输出只作为 decision evidence 或 suggestion。
```

### Context & Message Compiler

Context Compiler 决定哪些 admitted item、feedback summary 或 evidence 进入 message list。

Admission 不决定 message list 可见性。

事实：

```text
accepted_local 不等于 visible。
waiting_evidence、quarantined、redacted 状态必须影响后续可见性判断。
```

### Evidence & Readiness

Evidence & Readiness 可使用反馈、验证报告和 runtime trace 作为证据。

Admission 不判断证据是否足够 hatch。

## 多层回流边界

事实：

```text
反馈必须记录 originLayer、targetLayer 和 attribution。
作品项目原始内容默认不向 feng 上游传播。
领域 agent 问题与系统性 feng 问题必须区分。
upstream proposal 不包含默认原文。
跨层传播必须有 policyDecisionId、redactedSummaryRef 和 evidenceRefs。
```

## 不变量

```text
收到输入不等于准入。
准入不等于上下文可见。
artifact registration 不等于 admission。
feedback candidate 不等于 accepted_local。
proposed_upstream 不等于 accepted_upstream。
accepted_local 不等于上游吸收。
隐私不明时默认不上游。
default_feedback_router 不直接修改 feedback status。
所有状态变化必须写事件。
大型内容通过 ArtifactRef 表达。
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
feedback_status_conflict
admission_conflict
upstream_policy_required
redaction_required
```

事实：

```text
缺少 growUnitRef 的输入返回 invalid_input。
artifact metadata 不可用时不能执行高风险 upstream proposal。
隐私未明时 upstream proposal 返回 upstream_policy_required 或 privacy_blocked。
状态不兼容时返回 feedback_status_conflict 或 admission_conflict。
```

## 验证要求

实现阶段应验证：

```text
receiveUserInput 只创建 inbox item，不生成 message list。
目录新增文件只产生 candidate，不自动进入上下文。
runtime feedback 默认是 candidate。
proposed_upstream 不会自动变成 accepted_upstream。
contains_secret 或 project_private 内容默认不能上游传播。
redacted feedback 不返回原始内容给 upstream proposal。
所有 feedback status 可由 feedback_unit stream 重建。
Context Compiler 之外不能把 admitted item 写入 message list。
```

## 开放问题

```text
InboxItemId 是否需要提升到 Domain Model & Contracts 的全局 id，需要等后续模块引用范围确定。
default_feedback_router 的策略输出结构需要与 Context Compiler 和 Debug & Feedback Bridge 联合收敛。
目录监听和外部事件接入属于实现阶段或 CLI/adapter 设计。
accepted_local 与 Agenda/DoD 的具体联动需要等 Agenda & DoD Manager spec 确定。
```

这些问题不影响本模块当前终态事实：Admission & Feedback Inbox 是输入和反馈的准入、归因、状态与上游提议管理层，不是上下文编译器、记忆系统或上游吸收器。
