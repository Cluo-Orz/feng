# Tool Runtime Spec

本文是 `Tool Runtime` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Tool Runtime` 是 feng 的工具定义、工具面摘要、工具调用校验、policy enforce、执行、结果归档和 settlement 层。

它处理工具调用这种会产生真实外部效果的边界，但不拥有 grow 目标、prompt 语义、message list 可见性、readiness 判断或 hatch 判断。

## 职责

该模块负责：

```text
登记 tool definition。
管理 tool source、version、lifecycle、risk 和 capability 声明。
提供 tool surface summary。
校验 tool call 输入。
为工具动作请求 PolicyDecision。
根据 PolicyDecision 和结构性 guard 执行或拒绝执行。
执行工具并处理 timeout、cancel、并发限制和资源限制摘要。
归一化 stdout、stderr、structured output、side effect 和错误。
把大型工具结果注册为 tool_result artifact。
生成 ToolExecutionReceipt。
生成 ToolSettlement。
记录 tool lifecycle、execution 和 settlement 事件。
解释一次 tool call 为什么可见、为什么被拒绝、如何执行、结果在哪里。
```

该模块不负责：

```text
决定本轮 message list 的 visible tools。
编译 prompt 或 message list。
调用 LLM。
解析 provider 原始 tool-call format。
执行 skill。
根据 skill 自动启用工具。
管理插件市场。
提供 MCP adapter 生态。
判断 grow readiness。
修改 grow lifecycle。
判断 DoD 是否满足。
写入 Agenda。
直接采纳 feedback。
保存 secret。
提供强 OS sandbox。
决定 hatch package 内容。
执行目标世界语义动作。
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

Used by:
  Grow Attempt Runner
  Context & Message Compiler
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
Tool Runtime 通过 Artifact Registry 注册 tool_result artifact。
Tool Runtime 通过 Policy & Capability Boundary 获取工具动作的 PolicyDecision。
Tool Runtime 可以读取 Skill Registry 的 declaredToolRefs 和 declaredCapabilities summary，但不让 skill 自动注册或启用工具。
Tool Runtime 不直接依赖 LLM Gateway。
Tool Runtime 不导入 Context & Message Compiler 的编译逻辑。
Context & Message Compiler 通过编排层或只读 port 获取 ToolSurfaceSummary。
Grow Attempt Runner 是 LLM tool-call block 与 Tool Runtime 执行之间的编排者。
```

## Tool Definition

ToolDefinition 是工具的 catalog 事实。

ToolDefinition 至少表达：

```text
toolId
toolRef
name
namespace
version
lifecycle
source
description
inputSchemaRef
inputSchemaSummary
outputSchemaSummary
declaredCapabilities
declaredRiskLevel
sideEffectProfile
credentialRequirementSummary
timeoutPolicy
concurrencyPolicy
implementationRef
compatibility
audit
```

Tool source 至少表达：

```text
system_default
workspace_local
grow_generated
hatch_imported
runtime_imported
external_package
host_provided
```

Tool lifecycle 至少表达：

```text
discovered
registered
active
disabled
deprecated
retracted
unavailable
incompatible
```

事实：

```text
ToolDefinition 是工具能力事实，不是 message list 可见性。
registered tool 不等于 active tool。
active tool 不等于 visible tool。
visible tool 不等于 executable tool。
declaredCapabilities 描述工具可能请求的能力，不授予权限。
implementationRef 不暴露给 Context Compiler。
external_package、grow_generated、hatch_imported 和 runtime_imported 工具默认需要 PolicyDecision 才能 active。
```

## Tool Surface Summary

ToolSurfaceSummary 是供 Context Compiler、Grow Attempt Runner 和 CLI 使用的只读摘要。

它至少表达：

```text
toolSurfaceSummaryId
scope
candidateToolRefs
excludedToolRefs
toolSummaries
capabilitySummaries
riskSummaries
policyBoundarySummaries
compatibilitySummaries
source
version
audit
```

每个 tool summary 至少表达：

```text
toolRef
name
version
descriptionSummary
inputSchemaSummary
outputSchemaSummary
declaredCapabilities
declaredRiskLevel
sideEffectProfileSummary
credentialRequirementSummary
visibilityHint
exclusionReason
```

事实：

```text
ToolSurfaceSummary 是候选工具面，不是 message list。
Context & Message Compiler 决定本轮 visible tools。
visible tool 必须在 message list source map 中可追溯。
Tool Runtime 不知道本轮 prompt section 如何组织。
Tool Runtime 不因为工具出现在 ToolSurfaceSummary 中就允许执行。
```

## Tool Call Request

ToolCallRequest 表达一次待执行工具调用。

它至少包含：

```text
toolCallId
toolRef
toolVersion
attemptRef
growUnitRef
messageListRef
requestedBy
input
inputArtifactRef
reason
correlationId
causationId
source
audit
```

requestedBy 至少表达：

```text
grow_attempt_runner
agent_runtime_kernel
cli
debug_bridge
target_world_adapter
```

事实：

```text
ToolCallRequest 是执行请求，不是执行事实。
模型提出的 tool-call block 必须先被 Grow Attempt Runner 转成 ToolCallRequest。
ToolCallRequest 可以引用 MessageListRef，但 Tool Runtime 不读取 message list 语义。
大型输入通过 inputArtifactRef 表达。
缺少 reason 或 source 的高风险调用返回 invalid_input。
```

## Input Validation

ToolInputValidation 表达工具输入校验结果。

它至少包含：

```text
validationId
toolCallId
toolRef
schemaVersion
valid
normalizedInput
redactedInputPreview
issues
inputHash
source
audit
```

issue 类型至少包括：

```text
missing_required_field
unknown_field
type_mismatch
schema_version_mismatch
unsupported_value
artifact_unavailable
privacy_blocked
input_too_large
unsafe_path
unsafe_command
credential_missing
```

事实：

```text
输入校验成功不等于 policy allow。
输入校验失败不会执行工具。
normalizedInput 是执行输入的受控表示。
redactedInputPreview 可进入 trace，完整敏感输入默认不进入事件 payload。
```

## Policy Enforcement

工具执行前必须表达工具动作的 policy decision。

ToolActionPolicyRequest 至少表达：

```text
toolCallId
toolRef
declaredCapabilities
requestedCapabilities
resourceSummary
sideEffectProfile
artifactRefs
workspace
growUnitRef
attemptRef
reason
source
correlationId
```

事实：

```text
高风险 capability 没有 PolicyDecision 时不执行工具。
Policy allow 不等于工具执行成功。
Policy deny、ask、unsupported 会生成 ToolSettlement。
allow_with_constraints 要求 Tool Runtime enforce constraints。
allow_with_redaction 要求使用脱敏输入或脱敏 artifact。
PolicyDecision 不替代 File-Native Store 的路径 containment。
PolicyDecision 不替代宿主 sandbox。
```

## Tool Execution

ToolExecution 是一次工具执行事实。

执行状态至少包括：

```text
queued
validating
waiting_policy
running
cancelling
settling
succeeded
failed
timed_out
cancelled
policy_blocked
invalid_input
unavailable
```

ToolExecutionReceipt 至少表达：

```text
toolExecutionId
toolCallId
toolRef
toolVersion
status
startedAt
completedAt
attemptRef
growUnitRef
messageListRef
policyDecisionId
inputValidationRef
inputHash
outputArtifactRef
outputPreviewRef
stdoutSummary
stderrSummary
structuredOutputSummary
sideEffectSummary
resourceUsageSummary
errorClassification
retryable
correlationId
source
audit
```

事实：

```text
ToolExecutionReceipt 是执行事实，不是 grow state。
ToolExecutionReceipt 不包含 secret 原文。
stdout、stderr 和大型 structured output 通过 tool_result artifact 或 preview 表达。
sideEffectSummary 必须说明受影响资源的摘要和边界。
执行成功只说明工具调用成功，不说明 DoD 满足。
```

## Tool Result Artifact

工具输出通过 Artifact Registry 管理。

ToolResultArtifact 至少表达：

```text
artifactRef
toolCallId
toolRef
toolVersion
kind = tool_result
contentHash
mediaType
privacyClass
retentionClass
parentRefs
previewRef
source
audit
```

事实：

```text
单次工具执行的大型输出由 Tool Runtime 注册为 tool_result artifact。
tool_result artifact 不自动进入下一轮 message list。
tool_result artifact 不自动成为 evidence。
tool_result artifact 不自动修改 grow 事实。
Context & Message Compiler 后续可以选择其 summary、preview 或片段。
Evidence & Readiness 后续可以把它作为候选证据读取。
```

## Tool Settlement

ToolSettlement 表达一次工具调用对调用方的结算结果。

它至少包含：

```text
toolSettlementId
toolCallId
attemptRef
status
executionReceiptRef
resultArtifactRef
resultPreview
errorClassification
retryRecommendation
nextActionHint
visibleToModelSummary
source
audit
```

status 至少包括：

```text
succeeded
failed
timed_out
cancelled
policy_blocked
invalid_input
unavailable
unsupported
```

事实：

```text
ToolSettlement 是调用结算，不是 readiness verdict。
visibleToModelSummary 是可供下一轮编译候选的摘要，不是直接追加到 message list 的内容。
retryRecommendation 是工具层建议，不是 attempt retry 决策。
nextActionHint 不改写 Agenda。
Grow Attempt Runner 决定如何继续 attempt。
```

## Error Classification

工具错误分类至少包括：

```text
tool_not_found
tool_unavailable
tool_retracted
tool_incompatible
invalid_input
schema_incompatible
policy_blocked
approval_required
permission_denied
credential_missing
path_escape_rejected
artifact_unavailable
timeout
cancelled
execution_failed
output_invalid
output_too_large
side_effect_unknown
host_sandbox_unavailable
external_service_failed
unknown_tool_error
```

事实：

```text
错误分类面向调用方和 trace，不要求调用方解析自然语言错误。
unknown_tool_error 必须保留安全摘要和 correlationId。
side_effect_unknown 表示副作用边界不可解释，后续 readiness 和 hatch 默认不能把该结果视为稳定证据。
```

## Ports

### Registry Port

```text
discoverTools(scope) -> Result<ToolDiscoveryReport>
registerTool(input) -> Result<ToolRef>
getTool(toolRef) -> Result<ToolDefinition>
listTools(query) -> Result<ToolCatalogPage>
updateToolLifecycle(toolRef, lifecycle, reason) -> Result<ToolLifecycleReceipt>
```

事实：

```text
discover 不等于 register。
register 不等于 active。
active 不等于 visible。
retracted tool 不进入新 tool surface。
```

### Surface Port

```text
describeToolSurface(scope, contextSummary) -> Result<ToolSurfaceSummary>
explainToolSurface(summaryRef) -> Result<ToolSurfaceExplanation>
```

事实：

```text
describeToolSurface 不编译 message list。
ToolSurfaceSummary 只暴露摘要、capability、risk 和 boundary。
ToolSurfaceSummary 不暴露工具实现细节。
```

### Validation Port

```text
validateToolCall(request) -> Result<ToolInputValidation>
explainToolInputValidation(validationRef) -> Result<ToolInputValidationExplanation>
```

事实：

```text
validateToolCall 不执行工具。
校验失败返回结构化 issues。
```

### Execution Port

```text
executeTool(request, options) -> Result<ToolSettlement>
cancelToolExecution(toolExecutionId, reason) -> Result<ToolSettlement>
readToolExecutionReceipt(receiptRef) -> Result<ToolExecutionReceipt>
readToolSettlement(settlementRef) -> Result<ToolSettlement>
```

事实：

```text
executeTool 内部顺序包含 validate、policy、execute、artifact register 和 settlement。
cancel 通过状态和事件表达，不删除历史执行事实。
执行失败仍生成可审计 settlement。
```

## 事件

该模块写入 tool 相关事件。

事件类型至少包括：

```text
tool_discovered
tool_registered
tool_lifecycle_changed
tool_surface_described
tool_call_received
tool_input_validated
tool_policy_checked
tool_execution_started
tool_execution_completed
tool_execution_failed
tool_execution_cancelled
tool_result_registered
tool_call_settled
```

事实：

```text
Tool 事件通过 Event Ledger 追加。
大型输入、输出和执行日志通过 ArtifactRef 引用。
事件 payload 保存摘要、状态、PolicyDecisionId、receiptRef 和 correlationId。
纠错通过新事件表达，不改写旧事件。
```

## 与其他模块的边界

### Skill Registry

Skill Registry 记录 skill 声明的 tool/capability 需求。

Tool Runtime 管理真实 tool registry 和执行。

事实：

```text
declaredToolRefs 不注册工具。
declaredCapabilities 不授予工具权限。
skill active 不等于 tool active。
```

### Context & Message Compiler

Tool Runtime 提供 ToolSurfaceSummary。

Context Compiler 决定本轮 visible tools 并写入 source map。

事实：

```text
Tool Runtime 不决定 message list visibility。
Context Compiler 不执行工具。
visible tool 不等于 executable tool。
```

### LLM Gateway

LLM Gateway 归一化模型提出的 tool-call block。

Tool Runtime 执行经过 Grow Attempt Runner 转换后的 ToolCallRequest。

事实：

```text
Tool Runtime 不直接依赖 LLM Gateway。
tool-call block 不等于 tool execution。
```

### Grow Attempt Runner

Grow Attempt Runner 编排 attempt lifecycle、LLM turn、tool settlement 和 attempt trace。

Tool Runtime 返回 ToolSettlement。

事实：

```text
Tool Runtime 不决定 attempt 是否继续。
Tool Runtime 不写 attempt trace 的最终结构。
ToolSettlement 可以被 Attempt Runner 引用。
```

### Policy & Capability Boundary

Policy 判断工具动作是否允许。

Tool Runtime 执行或拒绝执行，并 enforce constraints。

事实：

```text
PolicyDecision 不是执行结果。
Policy allow 不绕过工具输入校验或 File Store containment。
Policy deny 生成 policy_blocked settlement。
```

### Artifact Registry

Artifact Registry 保存 tool_result artifact、preview 和 metadata。

Tool Runtime 是单次工具执行结果的 owning creator。

事实：

```text
Artifact Registry 不执行工具。
Tool Runtime 不决定 tool_result 是否进入上下文、evidence 或 hatch。
```

### File-Native Store

File Store 执行 workspace path containment、原子读写和 receipt。

Tool Runtime 使用 File Store 或 host adapter 执行工具需要的文件动作。

事实：

```text
即使 policy allow，路径逃逸仍失败。
Tool Runtime 不暴露裸绝对路径给上层业务模块。
```

### Target World Adapter

Target World Adapter 表达目标世界动作、事件和验证入口。

Tool Runtime 执行通用工具，不解释目标世界业务语义。

事实：

```text
runtime.target_action 的语义由 Target World Adapter 管理。
Tool Runtime 只在被授权时执行具体工具动作或 host action。
```

## 不变量

```text
registered tool 不等于 visible tool。
visible tool 不等于 executable tool。
tool-call block 不等于 tool execution。
输入校验成功不等于 policy allow。
Policy allow 不等于工具执行成功。
ToolExecutionReceipt 不等于 grow state。
ToolSettlement 不等于 readiness verdict。
tool_result artifact 不等于 message list。
工具输出不直接改 grow lifecycle。
工具输出不直接进入下一轮上下文。
高风险工具动作必须有 PolicyDecision。
Tool Runtime 不调用 LLM。
Tool Runtime 不编译 message list。
Tool Runtime 不执行 skill。
Tool Runtime 不保存 secret。
Tool Runtime 不提供强 OS sandbox。
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
tool_unavailable
tool_retracted
tool_incompatible
credential_missing
path_escape_rejected
timeout
cancelled
execution_failed
output_invalid
output_too_large
host_sandbox_unavailable
external_service_failed
```

事实：

```text
retracted tool 被调用时返回 tool_retracted。
policy deny 时不执行工具，并生成 policy_blocked settlement。
输入 schema 不兼容时不执行工具。
输出过大时注册 artifact 或返回 output_too_large，不把大输出内联给调用方。
执行中断或超时必须产生可审计 settlement。
```

## 验证要求

实现阶段应验证：

```text
registered tool 不会自动进入 message list。
visible tool 没有有效 ToolCallRequest 时不会执行。
LLM tool-call block 不会绕过 Grow Attempt Runner 直接执行。
高风险工具调用没有 PolicyDecision 时不能执行。
policy deny 生成 settlement 且没有副作用执行。
输入校验失败不执行工具。
工具结果被注册为 tool_result artifact。
大型 stdout/stderr 不内联进事件。
工具成功不会触发 ready_to_hatch。
Tool Runtime 不 import LLM Gateway。
Tool Runtime 不 import Context Compiler 编译逻辑。
```

## 开放问题

```text
工具实现的具体 adapter 形态属于实现阶段。
host sandbox、进程隔离、Windows job object 或 container 集成属于宿主能力设计。
credential storage 的归属需要与 LLM Gateway、Policy 或专门凭据模块联合确认。
ToolSurfaceSummary 的最小 provider-visible 映射需要与 Context Compiler 和 LLM Gateway 联合收敛。
```

这些问题不影响本模块当前终态事实：Tool Runtime 是工具定义、工具面摘要、输入校验、policy enforce、执行、结果归档和 settlement 层，不是 prompt 编译器、LLM gateway、readiness 裁判或插件生态中心。

