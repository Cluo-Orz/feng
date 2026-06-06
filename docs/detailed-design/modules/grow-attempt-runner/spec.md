# Grow Attempt Runner Spec

本文是 `Grow Attempt Runner` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Grow Attempt Runner` 是一次 grow attempt 的可恢复执行编排层。

它把 `AttemptIntent`、Context Compiler、LLM Gateway、Tool Runtime、Artifact Registry 和 Event Ledger 串成一次文件化执行片段，并产出 attempt trace、candidate output 和 outcome summary。

它不是 Grow Kernel 的大脑，不决定目标，不编译 prompt，不执行工具，不判断 readiness，也不修改 grow lifecycle。

## 职责

该模块负责：

```text
创建 AttemptRecord。
绑定 AttemptIntent。
捕获 attempt input snapshot。
构造 AttemptExecutionPlan。
请求 Context & Message Compiler 编译 message list。
请求 PolicyDecision 用于 LLM provider 调用边界。
调用 LLM Gateway。
记录 normalized stream events、response summary 和 ProviderCallReceipt。
把模型 tool-call blocks 转换为 ToolCallRequest。
调用 Tool Runtime 并等待 ToolSettlement。
在 tool settlement 后请求 Context Compiler 编译 continuation message list。
管理 attempt turn loop。
处理 attempt-level retry、cancel、interrupt、timeout 和 stop condition。
注册 candidate_output artifact。
注册 attempt_trace artifact。
生成 AttemptOutcomeSummary。
写入 attempt lifecycle 和 trace checkpoint 事件。
解释一次 attempt 的输入、过程、输出、失败和恢复点。
```

该模块不负责：

```text
创建或修订 grow 目标。
准入用户输入或反馈。
设计 Agenda、Gap 或 DoD。
编译 message list 内容。
选择本轮 visible skills 或 visible tools。
调用 provider 原始协议。
解析 provider 原始 tool-call format。
执行工具。
判断工具权限。
判断工具结果是否满足 DoD。
判断 readiness。
把 grow unit 改成 ready_to_hatch。
修改 grow lifecycle。
构建 hatch package。
保存 provider session。
提供用户可见 session。
管理 runtime agent 生产循环。
```

## 依赖关系

```text
Depends on:
  Domain Model & Contracts
  File-Native Store
  Event Ledger & Projection
  Artifact Registry
  Policy & Capability Boundary
  Grow Unit Manager
  Admission & Feedback Inbox
  Agenda & DoD Manager
  Context & Message Compiler
  LLM Gateway
  Tool Runtime

Used by:
  Grow Unit Manager
  Evidence & Readiness
  Hatch Builder
  Runtime Contract Registry
  Debug & Feedback Bridge
  CLI
```

事实：

```text
Grow Attempt Runner 读取 GrowUnitStateSnapshot、AdmissionSummary、AgendaSummary 和 AttemptIntent。
Grow Attempt Runner 请求 Context Compiler 生成 MessageListRef。
Grow Attempt Runner 请求 LLM Gateway 执行 provider 调用。
Grow Attempt Runner 请求 Tool Runtime 执行工具并返回 ToolSettlement。
Grow Attempt Runner 通过 Artifact Registry 注册 candidate_output 和 attempt_trace artifact。
Grow Attempt Runner 通过 Event Ledger 写入 attempt stream。
Grow Attempt Runner 不直接依赖 Evidence & Readiness。
Grow Attempt Runner 不直接改 Grow Unit lifecycle。
```

## Attempt Record

AttemptRecord 是一次 grow attempt 的业务事实。

AttemptRecord 至少表达：

```text
attemptId
attemptRef
growUnitRef
attemptIntentRef
status
executionPlanRef
inputSnapshotRef
messageListRefs
llmRequestRefs
providerReceiptRefs
toolCallRefs
toolSettlementRefs
candidateOutputRefs
attemptTraceRef
outcomeSummaryRef
startedAt
completedAt
exitReason
correlationId
source
audit
```

Attempt status 使用 Domain Model & Contracts 的 attempt lifecycle：

```text
created
compiled
running
waiting_tool
settling
completed
failed
interrupted
cancelled
```

事实：

```text
AttemptRecord 是 attempt 投影视图，不是真相来源。
AttemptRecord 可从 attempt stream 重建。
attempt completed 只表示本次执行片段结束，不表示 grow 目标完成。
attempt failed 不直接改变 grow lifecycle。
attempt interrupted 可恢复，但恢复必须从 file-native checkpoint 开始。
attempt 不是用户可见 session。
```

## Attempt Input Snapshot

AttemptInputSnapshot 是 attempt 开始时的输入快照。

它至少包含：

```text
attemptRef
growUnitSnapshotRef
admissionSummaryRef
agendaSummaryRef
attemptIntentRef
activeDoDRefs
openGapRefs
toolSurfaceSummaryRef
skillCandidateSummaryRef
policyBoundarySummaryRef
artifactCandidateRefs
source
version
audit
```

事实：

```text
input snapshot 是执行输入事实，不是真相来源。
input snapshot 只保存 summary 和 Ref，不内联大型内容。
input snapshot 用于解释本次 attempt 为什么以这些上下文启动。
input snapshot 不替代 Context Compiler 的 source map。
```

## Attempt Execution Plan

AttemptExecutionPlan 表达本次 attempt 的执行约束。

它至少包含：

```text
executionPlanId
attemptRef
attemptIntentRef
modelRequirementSummary
toolUsePolicy
maxTurns
maxToolCalls
timeoutPolicy
retryPolicy
streamingPreference
stopCondition
policyDecisionRefs
source
audit
```

事实：

```text
ExecutionPlan 是执行约束，不是 grow 策略。
ExecutionPlan 不创建新的 grow 目标。
ExecutionPlan 不改变 AttemptIntent。
retryPolicy 是 attempt-level retry 边界，不替代 LLM Gateway 的 provider-level retry。
toolUsePolicy 不授予工具权限，工具权限仍由 Tool Runtime 和 Policy 决定。
```

## Turn Record

AttemptTurnRecord 表达 attempt 内部一次 LLM turn。

它至少包含：

```text
turnId
attemptRef
turnIndex
messageListRef
llmRequestRef
providerReceiptRef
normalizedResponseRef
toolCallRefs
toolSettlementRefs
candidateOutputRefs
status
startedAt
completedAt
source
audit
```

turn status 至少包括：

```text
compiled
calling_llm
waiting_tool
settled
completed
failed
interrupted
cancelled
```

事实：

```text
turn 是 attempt trace 内部记录，不是用户 session。
每个 turn 必须引用 MessageListRef。
MessageListRef 必须来自 Context & Message Compiler。
turn 不保存 provider session id 作为业务事实。
```

## Message List Sequence

一次 attempt 可以包含多个 MessageListRef。

事实：

```text
attempt_start turn 使用 Context Compiler 编译的 initial message list。
tool settlement 后的 continuation turn 使用 Context Compiler 编译的新 message list。
retry、resume 或 context invalidation 后必须生成新的 MessageListRef 或显式复用已有 MessageListRef 并记录 reason。
Runner 不在内存里直接拼接 tool result 到 provider request。
Runner 不修改旧 message list artifact。
```

continuation compile input 至少表达：

```text
previousTurnRef
toolSettlementRefs
newCandidateOutputRefs
attemptTraceSummaryRef
compileReason
correlationId
```

事实：

```text
tool result 进入下一轮模型可见内容前，必须先成为 ToolSettlement、tool_result artifact 或 summary。
Context Compiler 决定是否把这些内容编入 continuation message list。
LLM Gateway 只消费 MessageListRef 或 provider-neutral messages。
```

## LLM Call Handling

LLM call 由 Runner 编排、由 LLM Gateway 执行。

LLM call 输入至少包括：

```text
messageListRef
providerNeutralMessages
modelSelection
requiredCapabilities
toolSurfaceSummary
streaming
timeout
retryPolicy
fallbackPolicy
policyDecisionId
correlationId
```

事实：

```text
Runner 在调用 LLM Gateway 前取得必要 PolicyDecision。
LLM Gateway 的 provider-level retry/fallback 不等于 attempt-level retry。
NormalizedLLMResponse 不等于 attempt success。
ProviderCallReceipt 可被 AttemptTrace 引用。
stream interruption 必须记录 partial summary 和 explicit error。
Runner 不解析 provider 原始协议。
```

## Tool Call Handling

模型提出 tool-call 后，Runner 把 normalized tool-call block 转换为 ToolCallRequest。

ToolCallRequest 至少引用：

```text
attemptRef
growUnitRef
messageListRef
toolRef
toolVersion
input
inputArtifactRef
reason
correlationId
causationId
```

事实：

```text
tool-call block 不等于工具执行。
Runner 不校验工具 schema。
Runner 不判断工具权限。
Runner 不执行工具。
Tool Runtime 返回 ToolSettlement。
ToolSettlement 不等于 readiness verdict。
工具失败不必然导致 attempt failed，必须受 ExecutionPlan、stopCondition 和 retryPolicy 约束。
```

## Candidate Output

Candidate output 是 attempt 产生的候选产物。

CandidateOutputRecord 至少表达：

```text
candidateOutputId
attemptRef
growUnitRef
sourceTurnRef
artifactRef
kind
summary
parentRefs
privacyClass
retentionClass
source
audit
```

kind 至少包括：

```text
model_text
structured_output
file_patch_candidate
runtime_contract_candidate
skill_candidate
tool_plan_candidate
validation_instruction_candidate
unknown
```

事实：

```text
candidate_output artifact 不等于 accepted result。
candidate_output artifact 不等于 evidence verdict。
candidate_output artifact 不等于 hatch package content。
大型模型输出必须通过 ArtifactRef 表达。
contains_secret 或 contains_user_content 的候选输出必须带 privacy metadata。
```

## Attempt Checkpoint

AttemptCheckpoint 是长程任务恢复边界。

它至少包含：

```text
checkpointId
attemptRef
phase
status
lastCompletedTurnRef
latestMessageListRef
latestProviderReceiptRef
latestToolSettlementRefs
latestCandidateOutputRefs
traceFragmentRef
resumeInstructionSummary
createdAt
source
audit
```

phase 至少包括：

```text
after_snapshot
after_compile
after_llm_response
after_tool_settlement
after_candidate_output
before_retry
before_interrupt
final
```

事实：

```text
每个关键边界都有 checkpoint。
checkpoint 是 file-native 恢复依据。
checkpoint 不依赖 provider session。
checkpoint 不包含完整大内容。
恢复时必须验证 checkpoint 引用的 MessageListRef、receipt、settlement 和 artifact 可读。
```

## Attempt Trace

AttemptTraceArtifact 是 attempt 的完整执行轨迹。

它至少表达：

```text
attemptTraceId
attemptRef
growUnitRef
inputSnapshotRef
executionPlanRef
turnRefs
checkpointRefs
eventRefs
messageListRefs
providerReceiptRefs
toolSettlementRefs
candidateOutputRefs
exitReason
contentHash
source
audit
```

事实：

```text
attempt_trace 是 artifact。
Attempt Runner 是 attempt_trace artifact 的 owning creator。
trace 中的大型响应、日志和输出通过 ArtifactRef 引用。
trace 可以解释 attempt 如何从 AttemptIntent 到 OutcomeSummary。
trace 不替代 Event Ledger。
```

## Attempt Outcome

AttemptOutcomeSummary 表达一次 attempt 的结算结果。

它至少包含：

```text
attemptRef
growUnitRef
status
exitReason
completedTurnCount
candidateOutputRefs
toolSettlementRefs
providerReceiptRefs
attemptTraceRef
observedIssueSummaries
evidenceCandidateRefs
nextModuleHints
source
audit
```

exitReason 至少包括：

```text
completed_no_tool_calls
completed_after_tool_settlement
stop_condition_reached
max_turns_reached
max_tool_calls_reached
context_compile_failed
llm_failed
tool_failed
policy_blocked
approval_required
input_invalid
retry_budget_exhausted
cancelled_by_user
interrupted_by_process
artifact_unavailable
unknown_failure
```

事实：

```text
OutcomeSummary 是 attempt 结算，不是 readiness verdict。
nextModuleHints 是给 Agenda、Evidence 或 CLI 的提示，不直接修改这些模块状态。
evidenceCandidateRefs 是候选证据引用，不表示证据充分。
completed status 不表示 ready_to_hatch。
```

## Long-Running Recovery

事实：

```text
Runner 不依赖 provider session 恢复。
Runner 不依赖进程内存保存关键状态。
恢复从 Event Ledger projection、AttemptCheckpoint、MessageListRef、ProviderCallReceipt、ToolSettlement 和 ArtifactRef 开始。
如果 LLM stream 在未完成响应前中断，恢复必须把该 turn 标记为 interrupted 或 failed，再根据 retryPolicy 发起新的 turn。
如果工具执行中断，恢复必须读取 Tool Runtime 的 settlement 或明确生成 cancelled/interrupted settlement。
恢复不能静默复用未知 provider 状态。
```

## Ports

### Attempt Lifecycle Port

```text
createAttempt(growUnitRef, attemptIntentRef, options) -> Result<AttemptRef>
startAttempt(attemptRef) -> Result<AttemptRunHandle>
runAttempt(attemptRef) -> Result<AttemptOutcomeSummary>
resumeAttempt(attemptRef, checkpointRef) -> Result<AttemptOutcomeSummary>
cancelAttempt(attemptRef, reason) -> Result<AttemptOutcomeSummary>
interruptAttempt(attemptRef, reason) -> Result<AttemptOutcomeSummary>
```

事实：

```text
createAttempt 写入 attempt_created 事件。
startAttempt 不创建用户 session。
runAttempt 可以执行多个 turn，但每个 turn 有 MessageListRef。
cancel 和 interrupt 写入事件并保留 trace。
```

### Trace Port

```text
readAttempt(attemptRef) -> Result<AttemptRecord>
readAttemptTrace(attemptRef) -> Result<AttemptTraceArtifact>
listAttempts(growUnitRef, query) -> Result<AttemptPage>
explainAttempt(attemptRef) -> Result<AttemptExplanation>
```

事实：

```text
explainAttempt 返回输入、message list、LLM call、tool settlement、candidate output、exitReason 和 checkpoint 的来源说明。
explainAttempt 不读取被 policy 阻断的原文。
```

### Internal Step Ports

```text
captureAttemptSnapshot(attemptRef) -> Result<AttemptInputSnapshot>
compileAttemptMessageList(attemptRef, reason) -> Result<MessageListRef>
callLLMForTurn(turnInput) -> Result<NormalizedLLMResponse>
settleToolCalls(turnRef, toolCallBlocks) -> Result<ToolSettlementList>
registerCandidateOutputs(turnRef, response) -> Result<CandidateOutputList>
checkpointAttempt(attemptRef, phase) -> Result<AttemptCheckpoint>
finalizeAttempt(attemptRef, outcome) -> Result<AttemptOutcomeSummary>
```

事实：

```text
这些 step port 产生 file-native 事件、artifact 或 checkpoint。
compileAttemptMessageList 只能调用 Context Compiler，不能手写 message list。
settleToolCalls 只能调用 Tool Runtime，不能执行工具。
finalizeAttempt 不调用 Evidence & Readiness。
```

## 事件

该模块写入 attempt stream。

事件类型至少包括：

```text
attempt_created
attempt_input_snapshot_captured
attempt_execution_plan_created
attempt_message_list_compiled
attempt_started
attempt_turn_started
attempt_llm_call_started
attempt_llm_call_completed
attempt_llm_call_failed
attempt_tool_call_requested
attempt_tool_settlement_recorded
attempt_candidate_output_registered
attempt_checkpoint_created
attempt_retry_recorded
attempt_interrupted
attempt_cancelled
attempt_failed
attempt_completed
attempt_trace_registered
attempt_outcome_recorded
```

事实：

```text
attempt 事件通过 Event Ledger 追加。
大型 message list、响应、trace、tool result 和候选产物通过 ArtifactRef 或 Ref 引用。
事件 payload 保存 status、summary、receiptRef、settlementRef、checkpointRef 和 correlationId。
纠错通过新事件表达，不改写旧事件。
```

## 与其他模块的边界

### Grow Unit Manager

Grow Unit Manager 拥有 grow lifecycle。

Grow Attempt Runner 拥有 attempt lifecycle。

事实：

```text
Runner 不直接改 grow lifecycle。
activeAttemptRef 的关联由 Grow Unit Manager 处理。
attempt outcome 可以被 Manager 作为生命周期协调输入。
```

### Admission & Feedback Inbox

Admission 拥有输入和反馈准入。

Runner 读取 AdmissionSummary 作为 snapshot 输入。

事实：

```text
Runner 不接收原始用户输入。
Runner 不把模型输出直接变成 feedback accepted。
```

### Agenda & DoD Manager

Agenda 提供 AttemptIntent。

Runner 执行 AttemptIntent。

事实：

```text
Runner 不修订 Agenda、Gap 或 DoD。
attempt failed 可以成为 Agenda 后续处理的输入摘要，但 Runner 不写 Agenda。
```

### Context & Message Compiler

Context Compiler 生成 message list artifact。

Runner 请求编译并使用 MessageListRef。

事实：

```text
Runner 不拼接 prompt。
Runner 不修改旧 message list。
continuation turn 也必须通过 Context Compiler。
```

### LLM Gateway

LLM Gateway 执行 provider 调用并归一化输出。

Runner 编排调用、记录 receipt 并处理归一化结果。

事实：

```text
Gateway response 不等于 attempt success。
Gateway provider-level retry 不等于 attempt retry。
Runner 不解析 provider 原始协议。
```

### Tool Runtime

Tool Runtime 执行工具并返回 ToolSettlement。

Runner 转换 tool-call block 并等待 settlement。

事实：

```text
Runner 不校验工具输入。
Runner 不执行工具。
ToolSettlement 不等于 readiness verdict。
工具结果进入下一轮模型可见内容前必须经过 Context Compiler。
```

### Evidence & Readiness

Evidence & Readiness 判断 evidence 和 readiness。

Runner 产出 AttemptOutcomeSummary、candidateOutputRefs、toolSettlementRefs 和 attemptTraceRef。

事实：

```text
Runner 不依赖 Evidence & Readiness。
Evidence & Readiness 可以读取 attempt outcome 作为候选证据输入。
completed attempt 不等于 ready_to_hatch。
```

### Artifact Registry

Artifact Registry 保存 candidate_output 和 attempt_trace artifact。

Runner 创建这些 artifact。

事实：

```text
artifact registration 不等于业务采纳。
candidate_output 不等于 hatch package content。
```

## 不变量

```text
attempt 不是 session。
turn 不是 session。
AttemptIntent 不等于 attempt。
attempt completed 不等于 grow complete。
attempt outcome 不等于 readiness verdict。
MessageListRef 必须来自 Context Compiler。
每个 LLM turn 必须引用 MessageListRef。
Runner 不手写 provider prompt。
Runner 不执行工具。
Runner 不判断 DoD 满足。
Runner 不改 grow lifecycle。
tool result 不直接进入下一轮上下文。
关键边界必须有 checkpoint。
恢复不依赖 provider session。
candidate_output 不等于 accepted result。
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
approval_required
privacy_blocked
version_unsupported
schema_incompatible
artifact_unavailable
context_budget_exceeded
llm_failed
provider_unavailable
stream_interrupted
tool_unavailable
tool_failed
tool_settlement_failed
attempt_cancelled
attempt_interrupted
attempt_timeout
retry_budget_exhausted
checkpoint_unavailable
resume_conflict
append_conflict
projection_stale
```

事实：

```text
缺少 AttemptIntent 时返回 invalid_input。
Context Compiler 失败时 attempt 不能调用 LLM。
LLM policy deny 时 provider call 不执行。
Tool Runtime 返回 policy_blocked settlement 时 Runner 记录 settlement 并按 stopCondition 结束或重试。
checkpoint 不可读时 resume 返回 checkpoint_unavailable。
恢复引用与当前 projection 冲突时返回 resume_conflict。
retry budget 耗尽时返回 retry_budget_exhausted 并生成 outcome。
```

## 验证要求

实现阶段应验证：

```text
attempt 无法在没有 AttemptIntent 的情况下启动。
每个 turn 都有 MessageListRef。
所有 MessageListRef 都来自 Context Compiler。
工具调用不能绕过 Tool Runtime。
tool settlement 后 continuation message list 由 Context Compiler 生成。
Runner 不 import Context Compiler 的内部编译实现，只调用 port。
Runner 不 import Tool Runtime 的工具实现。
Runner 不调用 Evidence & Readiness。
attempt completed 不会触发 ready_to_hatch。
进程中断后可从 checkpoint 解释已完成步骤。
provider session id 不作为恢复依据。
candidate output 注册为 artifact 后仍不是 accepted result。
```

## 开放问题

```text
AttemptExecutionPlan 的默认 retry/maxTurns 策略需要与 CLI 和产品第一阶段体验联合确认。
stream delta 的完整保存粒度需要在实现阶段根据文件体积和审计需求取舍。
provider-neutral continuation message 的最小结构需要与 Context Compiler 和 LLM Gateway 联合收敛。
attempt 级并发锁与 Grow Unit Manager activeAttemptRef 的具体机制需要实现阶段确认。
```

这些问题不影响本模块当前终态事实：Grow Attempt Runner 是一次 grow attempt 的可恢复执行编排层，不是目标规划器、prompt 编译器、工具执行器、readiness 裁判或 grow lifecycle owner。

