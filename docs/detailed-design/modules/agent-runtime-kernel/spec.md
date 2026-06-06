# Agent Runtime Kernel Spec

本文是 `Agent Runtime Kernel` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Agent Runtime Kernel` 是 hatch 产物在需要 LLM agent 形态时使用的运行底座。

它根据 hatch package 和 Runtime Contract 接收目标世界输入，编译 runtime message list，调用 LLM Gateway，处理工具和目标世界动作，记录 runtime trace，并在调试模式下产生反馈候选提示。

它不是 feng 的产品中心，不是 Grow Kernel，不适用于所有 hatch 产物，也不是 prompt wrapper。

## 职责

该模块负责：

```text
加载 hatch package summary。
读取 locked RuntimeContractRef。
校验 runtime kernel type 是否支持 Agent Runtime Kernel。
接收 WorldInputEnvelope。
维护 RuntimeInvocation。
维护短期上下文。
读取已采纳长期记忆或 package resource。
编译 RuntimeMessageList。
调用 LLM Gateway。
处理 normalized tool-call blocks。
调用 Tool Runtime。
处理 runtime output。
调用 Target World Adapter 准备目标世界动作或事件。
记录 RuntimeTurn。
注册 runtime_message_list artifact。
注册 runtime_trace artifact。
生成 RuntimeFeedbackCandidateHint。
支持 debug mode trace 暴露。
保证 production mode 版本锁定。
```

该模块不负责：

```text
grow 单元目标规划。
输入和反馈准入。
readiness 判断。
hatch package 构建。
Runtime Contract 定义。
Target World Adapter 实现。
工具实现。
provider adapter 实现。
上游 proposal 生成。
feedback 采纳。
长期记忆采纳。
生产运行中自我修改。
所有 non-LLM runtime 的运行。
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
  Runtime Contract Registry
  Hatch Builder
  LLM Gateway
  Tool Runtime
  Target World Adapter

Used by:
  Debug & Feedback Bridge
  CLI
```

事实：

```text
Agent Runtime Kernel 通过 Artifact Registry 注册 runtime_message_list 和 runtime_trace artifact。
Agent Runtime Kernel 通过 LLM Gateway 调用 provider。
Agent Runtime Kernel 通过 Tool Runtime 执行工具。
Agent Runtime Kernel 通过 Target World Adapter 处理目标世界输入、输出、动作和失败映射。
Agent Runtime Kernel 读取 Runtime Contract Registry 的 contract summary。
Agent Runtime Kernel 不调用 Context & Message Compiler；它拥有 runtime message list 编译。
Agent Runtime Kernel 不直接写 Admission 或上游 grow。
```

## Runtime Invocation

RuntimeInvocation 表达一次 hatch agent 运行片段。

它至少包含：

```text
runtimeInvocationId
hatchPackageRef
runtimeContractRef
targetWorldRef
mode
status
worldInputRefs
runtimeMessageListRefs
llmRequestRefs
toolSettlementRefs
targetActionRequestRefs
runtimeOutputRefs
runtimeTraceRef
feedbackCandidateHintRefs
startedAt
completedAt
source
audit
```

mode 至少包括：

```text
production
debug
dry_run
replay
```

status 至少包括：

```text
created
running
waiting_tool
waiting_target
completed
failed
cancelled
interrupted
```

事实：

```text
RuntimeInvocation 不是 grow session。
production mode 使用锁定 package 和 contract。
debug mode 可以暴露更多 trace，但仍受 Policy 和 privacy 限制。
RuntimeInvocation 不修改 hatch package。
```

## Runtime Message List

RuntimeMessageList 是 hatch agent 每轮 LLM 输入的 file-native 表示。

它至少包含：

```text
runtimeMessageListId
runtimeMessageListRef
runtimeInvocationRef
runtimeContractRef
hatchPackageRef
turnRef
artifactRef
providerNeutralMessages
sections
sourceMapRef
budgetReportRef
exclusionListRef
contentHash
createdAt
source
audit
```

sections 至少包括：

```text
runtime_contract
target_world_input
current_observation
runtime_task
allowed_actions
forbidden_actions
short_term_context
long_term_memory_summary
visible_tools
debug_policy
output_contract
failure_policy
```

事实：

```text
RuntimeMessageList 是 artifact。
artifact kind 是 runtime_message_list。
Agent Runtime Kernel 是 runtime_message_list 的 owning creator。
RuntimeMessageList 不等于 grow compiled_message_list。
RuntimeMessageList 必须有 source map 和 budget report。
RuntimeMessageList 不直接包含被 policy 阻断的目标世界原文。
```

## Short-Term Context

ShortTermContext 表达一次 invocation 内可保留的短期运行状态。

它至少包含：

```text
shortTermContextId
runtimeInvocationRef
turnRefs
worldInputRefs
runtimeOutputRefs
toolSettlementRefs
targetActionRefs
summary
retentionPolicy
source
audit
```

事实：

```text
ShortTermContext 只服务当前 invocation 或 contract 指定的短期范围。
ShortTermContext 不自动成为长期记忆。
ShortTermContext 可被 runtime message list 引用或摘要。
```

## Long-Term Memory Read

LongTermMemoryRead 表达 runtime 读取已采纳长期知识。

它至少包含：

```text
memoryReadId
hatchPackageRef
runtimeContractRef
sourceArtifactRefs
scope
summary
policyDecisionId
source
audit
```

事实：

```text
长期记忆必须来自 hatch package、locked contract 或已采纳资源。
运行日志不自动成为长期记忆。
LongTermMemoryRead 是读取事实，不是记忆写入。
长期记忆写入或采纳不属于 Agent Runtime Kernel。
```

## Runtime Turn

RuntimeTurn 表达一次 runtime LLM/action turn。

它至少包含：

```text
runtimeTurnId
runtimeInvocationRef
turnIndex
worldInputRef
runtimeMessageListRef
llmRequestRef
providerReceiptRef
toolCallRefs
toolSettlementRefs
targetActionRequestRefs
runtimeOutputRef
status
startedAt
completedAt
source
audit
```

事实：

```text
每个 RuntimeTurn 必须有 RuntimeMessageListRef。
LLM response 不等于 runtime output accepted。
tool-call block 不等于 tool execution。
target action request 不等于 action executed。
```

## Runtime Output

RuntimeOutput 是符合 Runtime Contract 的运行输出。

它至少包含：

```text
runtimeOutputId
runtimeInvocationRef
runtimeTurnRef
runtimeContractRef
worldOutputEnvelopeRef
artifactRef
status
validationSummary
privacyClass
source
audit
```

status 至少包括：

```text
candidate
contract_valid
contract_invalid
dispatched
failed
redacted
```

事实：

```text
RuntimeOutput 必须经 Runtime Contract 和 Target World Adapter 校验。
candidate output 不等于目标世界已接受。
RuntimeOutput 不自动成为 feedback。
```

## Runtime Trace

RuntimeTrace 是 hatch agent 的运行轨迹 artifact。

它至少包含：

```text
runtimeTraceId
runtimeInvocationRef
hatchPackageRef
runtimeContractRef
targetWorldRef
turnRefs
runtimeMessageListRefs
providerReceiptRefs
toolSettlementRefs
targetActionRequestRefs
runtimeOutputRefs
debugSignalRefs
failureMappingRefs
contentHash
source
audit
```

事实：

```text
RuntimeTrace 是 artifact。
artifact kind 是 runtime_trace。
RuntimeTrace 不等于 feedback accepted。
RuntimeTrace 可被 Debug & Feedback Bridge 读取为反馈候选来源。
RuntimeTrace 可能包含隐私内容，读取和上传受 Policy 控制。
```

## Feedback Candidate Hint

RuntimeFeedbackCandidateHint 表达运行期发现的问题提示。

它至少包含：

```text
hintId
runtimeInvocationRef
runtimeTraceRef
targetWorldRef
summary
attributionHint
evidenceRefs
privacyClass
debugModeOnly
source
audit
```

事实：

```text
RuntimeFeedbackCandidateHint 不等于 FeedbackUnit。
Debug & Feedback Bridge 决定是否创建 feedback candidate。
Agent Runtime Kernel 不写 Admission 状态。
```

## Production Version Lock

production mode 必须遵守：

```text
hatchPackageRef 固定。
runtimeContractRef 固定。
skill version 固定。
runtime kernel version 固定。
package resource hash 固定。
核心 prompt/template/resource 不原地修改。
```

事实：

```text
生产运行中不能自我升级。
升级通过新的 grow、readiness、contract lock 和 hatch package version 发生。
debug mode 可以产生更多 trace，但不改变 production lock。
```

## Ports

### Runtime Port

```text
startRuntimeInvocation(input) -> Result<RuntimeInvocationRef>
runRuntimeTurn(invocationRef, worldInputRef) -> Result<RuntimeTurn>
completeRuntimeInvocation(invocationRef, reason) -> Result<RuntimeInvocationReceipt>
cancelRuntimeInvocation(invocationRef, reason) -> Result<RuntimeInvocationReceipt>
```

事实：

```text
startRuntimeInvocation 不创建 grow session。
runRuntimeTurn 编译 RuntimeMessageList 并调用 LLM Gateway。
complete 不产生 readiness verdict。
```

### Message Port

```text
compileRuntimeMessageList(input) -> Result<RuntimeMessageListRef>
explainRuntimeMessageList(runtimeMessageListRef) -> Result<RuntimeMessageListExplanation>
```

事实：

```text
compileRuntimeMessageList 创建 runtime_message_list artifact。
它不调用 Context & Message Compiler。
它必须写 source map、budget report 和 exclusion list。
```

### Trace Port

```text
recordRuntimeTrace(input) -> Result<RuntimeTraceRef>
readRuntimeTrace(runtimeTraceRef, options) -> Result<RuntimeTrace>
explainRuntimeInvocation(invocationRef) -> Result<RuntimeInvocationExplanation>
```

事实：

```text
readRuntimeTrace 受 privacy 和 Policy 限制。
explainRuntimeInvocation 返回 contract、message list、LLM、tool、target action 和 output 的来源链。
```

### Feedback Hint Port

```text
recordFeedbackCandidateHint(input) -> Result<RuntimeFeedbackCandidateHintRef>
listFeedbackCandidateHints(invocationRef) -> Result<RuntimeFeedbackCandidateHintPage>
```

事实：

```text
hint 是候选提示，不创建 FeedbackUnit。
```

## 事件

该模块写入 runtime_trace stream 或 runtime invocation stream。

事件类型至少包括：

```text
runtime_invocation_started
runtime_message_list_compiled
runtime_turn_started
runtime_llm_call_completed
runtime_tool_settlement_recorded
runtime_target_action_requested
runtime_output_recorded
runtime_trace_registered
runtime_feedback_hint_recorded
runtime_invocation_completed
runtime_invocation_failed
runtime_invocation_cancelled
```

事实：

```text
事件 payload 保存 summary 和 Ref，不内联大型 message list、trace、tool result 或目标世界状态。
纠错通过新事件表达，不改写旧事件。
```

## 与其他模块的边界

### Runtime Contract Registry

Runtime Contract 定义 agent runtime 的输入、输出、动作、debug、feedback 和 failure 边界。

Agent Runtime Kernel 消费 contract。

事实：

```text
Agent Runtime Kernel 不定义 contract。
contract 不兼容时 runtime 不启动。
```

### Hatch Builder

Hatch Builder 生成 hatch package。

Agent Runtime Kernel 加载 hatch package。

事实：

```text
Agent Runtime Kernel 不构建或修改 package。
package version 在 production mode 下锁定。
```

### Target World Adapter

Target World Adapter 归一化目标世界输入、输出、动作和失败。

Agent Runtime Kernel 通过 adapter 与目标世界交互。

事实：

```text
Agent Runtime Kernel 不绕过 Adapter 执行 target action。
WorldInputEnvelope 不等于 RuntimeMessageList。
```

### LLM Gateway

LLM Gateway 执行 provider 调用。

Agent Runtime Kernel 提供 runtime message list 和 request。

事实：

```text
LLM response 不等于 runtime output accepted。
Gateway 不判断 runtime contract。
```

### Tool Runtime

Tool Runtime 执行工具并返回 settlement。

Agent Runtime Kernel 只转换 normalized tool-call block 为工具请求。

事实：

```text
Agent Runtime Kernel 不执行工具。
ToolSettlement 不自动进入长期记忆。
```

### Debug & Feedback Bridge

Debug & Feedback Bridge 将 runtime trace、debug signal 和 feedback hint 转成 feedback candidate。

Agent Runtime Kernel 只产生 trace 和 hint。

事实：

```text
RuntimeFeedbackCandidateHint 不等于 FeedbackUnit。
Agent Runtime Kernel 不写上游 grow。
```

## 不变量

```text
Agent Runtime Kernel 不是 Grow Kernel。
Agent Runtime Kernel 不是 feng 产品中心。
Agent Runtime Kernel 不适用于所有 hatch 产物。
hatch agent 不能只是 prompt wrapper。
RuntimeMessageList 是 artifact。
runtime_message_list 不等于 compiled_message_list。
每个 RuntimeTurn 必须有 RuntimeMessageListRef。
RuntimeTrace 是 artifact。
运行日志不自动成为长期记忆。
RuntimeFeedbackCandidateHint 不等于 FeedbackUnit。
target action 必须经过 Target World Adapter 和 Policy。
production mode 不允许自我修改 package、contract 或核心 prompt。
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
contract_incompatible
package_unavailable
runtime_kernel_unsupported
runtime_message_compile_failed
llm_failed
tool_failed
target_action_rejected
runtime_output_invalid
runtime_trace_unavailable
production_lock_violation
```

事实：

```text
non_llm_runtime contract 启动 Agent Runtime Kernel 时返回 runtime_kernel_unsupported。
package resource hash 不匹配时返回 package_unavailable 或 production_lock_violation。
target action 未经 Policy 或 Adapter 时返回 policy_blocked 或 contract_incompatible。
runtime output 不符合 contract 时返回 runtime_output_invalid。
```

## 验证要求

实现阶段应验证：

```text
Agent Runtime Kernel 不会启动 non_llm_runtime package。
RuntimeMessageList 注册为 runtime_message_list artifact。
RuntimeMessageList 有 source map 和 budget report。
Agent Runtime Kernel 不创建 compiled_message_list artifact。
每个 RuntimeTurn 有 RuntimeMessageListRef。
工具调用不能绕过 Tool Runtime。
target action 不能绕过 Target World Adapter 或 Policy。
RuntimeTrace 不会自动创建 accepted feedback。
运行日志不会自动写入长期记忆。
production mode 下 package、contract、skill version 和资源 hash 不会被改写。
```

## 开放问题

```text
runtime_message_list 的具体 provider-neutral 结构需要与 LLM Gateway 联合收敛。
长期记忆的采纳来源和 storage 需要与后续 memory 设计或 Skill/Artifact 机制联合确认。
debug mode 暴露的 trace 粒度需要与 Debug & Feedback Bridge 和 CLI spec 联合确认。
第一阶段 Agent Runtime Kernel 是否优先服务小说场景，需要在 proof slice 中决定。
```

这些问题不影响本模块当前终态事实：Agent Runtime Kernel 是 hatch agent 的可选高质量运行底座，不是 Grow Kernel、prompt wrapper、自我升级器或所有 hatch 产物的统一模板。

