# Target World Adapter Spec

本文是 `Target World Adapter` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Target World Adapter` 是目标世界与 feng grow/hatch/runtime 之间的边界适配层。

它把具体目标世界的状态、输入、动作、事件、验证、失败和调试信号归一化到 Runtime Contract 和 feng 的证据/反馈体系中。

它不把所有目标世界压成对话接口，不实现目标世界平台，不运行 agent，也不绕过 policy 或 admission。

## 职责

该模块负责：

```text
登记 TargetWorldDescriptor。
登记 TargetWorldAdapterDefinition。
校验 RuntimeContract 与目标世界是否兼容。
归一化目标世界输入为 WorldInputEnvelope。
归一化 runtime 输出为 WorldOutputEnvelope。
构造 TargetActionRequest。
校验目标世界动作与 RuntimeContract 的 action boundary。
请求 runtime.target_action 相关 PolicyDecision。
归一化目标世界验证结果。
生成 validation_report artifact。
映射目标世界失败为标准 failure。
生成 TargetDebugSignal。
提供 target world summary。
记录 target world adapter 事件。
```

该模块不负责：

```text
运行 Agent Runtime Kernel。
调用 LLM。
执行工具。
构建 hatch package。
定义 Runtime Contract。
判断 readiness。
修改 grow lifecycle。
采纳 feedback。
发送 upstream proposal。
实现具体游戏引擎、小说平台、音乐工作站或模拟器。
把目标世界原始状态默认塞进 message list。
```

## 依赖关系

```text
Depends on:
  Domain Model & Contracts
  File-Native Store
  Event Ledger & Projection
  Artifact Registry
  Policy & Capability Boundary
  Runtime Contract Registry
  Hatch Builder
  Evidence & Readiness

Used by:
  Context & Message Compiler
  Grow Attempt Runner
  Agent Runtime Kernel
  Debug & Feedback Bridge
  CLI
```

事实：

```text
Target World Adapter 读取 RuntimeContractSummary 和 HatchPackageSummary。
Target World Adapter 通过 Policy 判断 runtime.target_action、debug_trace.upload 和外部 enforcement 边界。
Target World Adapter 通过 Artifact Registry 注册 validation_report、runtime_trace 或 summary 类 artifact。
Target World Adapter 通过 Event Ledger 写入 target_world 相关事件。
Target World Adapter 不直接依赖 Agent Runtime Kernel。
```

## Target World Descriptor

TargetWorldDescriptor 表达一个目标世界的边界。

它至少包含：

```text
targetWorldId
targetWorldRef
name
kind
description
inputKinds
outputKinds
actionKinds
validationKinds
debugSignalKinds
privacyBoundary
environmentBoundary
capabilityRequirements
source
version
audit
```

kind 至少包括：

```text
novel_project
game_engine
simulation
music_workflow
robotics_or_vehicle
cli_tool
service
file_workflow
custom
```

事实：

```text
TargetWorldDescriptor 是目标世界 summary，不是具体平台实现。
kind 不决定 runtime kernel type。
dialogue 不是默认输入形态。
目标世界私有内容默认留在本层。
```

## Adapter Definition

TargetWorldAdapterDefinition 表达一个 adapter 能支持什么。

它至少包含：

```text
adapterId
adapterRef
targetWorldRef
supportedRuntimeKernelTypes
supportedInputKinds
supportedOutputKinds
supportedActionKinds
supportedValidationKinds
hostIntegrationSummary
lifecycle
compatibility
policyBoundarySummary
source
version
audit
```

lifecycle 至少包括：

```text
candidate
registered
active
disabled
deprecated
retracted
incompatible
unavailable
```

事实：

```text
registered adapter 不等于 active adapter。
active adapter 不等于 action permitted。
adapter compatibility 不等于 readiness passed。
retracted adapter 不能用于新 hatch runtime。
```

## World Input Envelope

WorldInputEnvelope 是目标世界输入的归一化表示。

它至少包含：

```text
worldInputId
targetWorldRef
runtimeContractRef
hatchPackageRef
inputKind
rawInputArtifactRef
normalizedInputRef
stateSnapshotRef
privacyClass
correlationId
source
audit
```

inputKind 至少包括：

```text
state_snapshot
tick_state
dialogue_turn
file_material
event
sensor_frame
batch_job
manual_trigger
```

事实：

```text
WorldInputEnvelope 不等于 message list。
rawInputArtifactRef 不默认进入上下文。
normalizedInputRef 必须符合 Runtime Contract 的 InputContract。
dialogue_turn 是可选输入，不是默认形态。
```

## World Output Envelope

WorldOutputEnvelope 是 runtime 输出面向目标世界的归一化表示。

它至少包含：

```text
worldOutputId
targetWorldRef
runtimeContractRef
hatchPackageRef
outputKind
runtimeOutputRef
normalizedOutputRef
actionRequestRefs
eventRefs
privacyClass
correlationId
source
audit
```

outputKind 至少包括：

```text
structured_result
text_result
action_event
decision_event
control_command
file_artifact
patch_candidate
chapter_output
music_fragment
debug_event
feedback_candidate
```

事实：

```text
WorldOutputEnvelope 不执行动作。
WorldOutputEnvelope 必须符合 Runtime Contract 的 OutputContract。
feedback_candidate 输出仍必须进入 Admission & Feedback Inbox。
```

## Target Action Request

TargetActionRequest 表达 runtime 试图影响目标世界。

它至少包含：

```text
targetActionRequestId
targetWorldRef
runtimeContractRef
hatchPackageRef
actionKind
actionPayloadRef
resourceSummary
requiredCapabilities
policyDecisionId
boundaryDeclaration
dispatchStatus
correlationId
source
audit
```

dispatchStatus 至少包括：

```text
proposed
validated
waiting_policy
policy_blocked
dispatched
rejected_by_target
failed
cancelled
```

事实：

```text
TargetActionRequest 不等于 action executed。
validated 不等于 policy allow。
runtime.target_action 必须经过 PolicyDecision 或明确 external_enforcement。
policy allow 不等于目标世界接受动作。
```

## Validation Report

TargetValidationReport 表达目标世界验证结果。

它至少包含：

```text
validationReportId
targetWorldRef
runtimeContractRef
hatchPackageRef
validationKind
inputRefs
outputRefs
result
failureMappingRefs
artifactRef
evidenceCandidateRef
source
audit
```

result 至少包括：

```text
passed
failed
partial
inconclusive
blocked
not_available
```

事实：

```text
TargetValidationReport 可以注册 validation_report artifact。
Validation report 不等于 readiness verdict。
Evidence & Readiness 解释 validation report 是否满足 DoD。
```

## Failure Mapping

TargetFailureMapping 把目标世界失败映射为 runtime 可解释失败。

它至少包含：

```text
failureMappingId
targetWorldRef
runtimeContractRef
targetFailureKind
normalizedFailureKind
retryable
severity
attributionHint
evidenceRefs
source
audit
```

normalizedFailureKind 至少包括：

```text
invalid_input
invalid_output
action_rejected
target_unavailable
timeout
permission_denied
policy_blocked
contract_violation
adapter_incompatible
external_enforcement_failed
unknown_target_failure
```

事实：

```text
FailureMapping 是归一化事实，不决定 feedback 状态。
attributionHint 是候选归因，不是上游吸收结论。
```

## Debug Signal

TargetDebugSignal 表达目标世界调试信号。

它至少包含：

```text
debugSignalId
targetWorldRef
runtimeContractRef
hatchPackageRef
signalKind
summary
artifactRef
privacyClass
feedbackCandidateHint
policyDecisionId
correlationId
source
audit
```

signalKind 至少包括：

```text
state_snapshot
input_output_pair
action_trace
validation_trace
performance_sample
failure_trace
user_observation
environment_log
```

事实：

```text
DebugSignal 不等于 feedback accepted。
DebugSignal 不直接写入上游 grow。
Debug & Feedback Bridge 决定是否形成 feedback unit。
```

## Ports

### Descriptor Port

```text
registerTargetWorld(input) -> Result<TargetWorldRef>
getTargetWorld(targetWorldRef) -> Result<TargetWorldDescriptor>
registerAdapter(input) -> Result<TargetWorldAdapterRef>
listAdapters(query) -> Result<TargetWorldAdapterPage>
```

事实：

```text
registerTargetWorld 不实现目标世界。
registerAdapter 不表示该 adapter 可执行所有动作。
```

### Compatibility Port

```text
checkRuntimeContractCompatibility(runtimeContractRef, targetWorldRef) -> Result<TargetWorldCompatibilityReport>
explainCompatibility(reportRef) -> Result<TargetWorldCompatibilityExplanation>
```

事实：

```text
compatibility report 不等于 readiness verdict。
compatibility failure 可以成为 Evidence 或 Agenda 的输入候选。
```

### Input and Output Port

```text
normalizeWorldInput(input) -> Result<WorldInputEnvelope>
normalizeRuntimeOutput(output) -> Result<WorldOutputEnvelope>
validateWorldOutput(outputEnvelopeRef) -> Result<TargetOutputValidation>
```

事实：

```text
normalizeWorldInput 不编译 message list。
normalizeRuntimeOutput 不执行目标世界动作。
validateWorldOutput 只检查 contract 结构，不判断 readiness。
```

### Action Port

```text
prepareTargetAction(outputEnvelopeRef, actionInput) -> Result<TargetActionRequest>
dispatchTargetAction(actionRequestRef) -> Result<TargetActionReceipt>
cancelTargetAction(actionRequestRef, reason) -> Result<TargetActionReceipt>
```

事实：

```text
prepareTargetAction 不执行动作。
dispatchTargetAction 需要 PolicyDecision 或 external_enforcement 声明。
dispatch receipt 不等于 action 成功达到业务效果。
```

### Validation and Debug Port

```text
runTargetValidation(input) -> Result<TargetValidationReport>
recordTargetDebugSignal(input) -> Result<TargetDebugSignal>
mapTargetFailure(input) -> Result<TargetFailureMapping>
```

事实：

```text
runTargetValidation 只通过 adapter/host validation entry 产生 report。
Target World Adapter 不判断 readiness。
recordTargetDebugSignal 不创建 accepted feedback。
```

## 事件

该模块写入 target_world 相关事件。事件可落在 runtime_trace stream、grow_unit stream，或由 Event Ledger 在实现阶段提供 target_world stream。

事件类型至少包括：

```text
target_world_registered
target_world_adapter_registered
target_world_adapter_lifecycle_changed
target_world_contract_compatibility_checked
world_input_normalized
world_output_normalized
target_action_prepared
target_action_policy_checked
target_action_dispatched
target_action_failed
target_validation_reported
target_failure_mapped
target_debug_signal_recorded
```

事实：

```text
事件 payload 保存 summary、Ref、status 和 policyDecisionId，不内联大型目标世界状态。
大型输入、输出、trace 和验证报告通过 ArtifactRef 引用。
纠错通过新事件表达，不改写旧事件。
```

## 与其他模块的边界

### Runtime Contract Registry

Runtime Contract 定义输入、输出、动作、debug、feedback 和 failure 边界。

Target World Adapter 根据 contract 归一化目标世界交互。

事实：

```text
Adapter 不定义 runtime contract。
runtime output 必须符合 contract 才能成为 target action。
```

### Hatch Builder

Hatch Builder 构建 hatch package。

Target World Adapter 使用 package 和 contract summary 运行适配。

事实：

```text
Adapter 不构建 package。
package 缺少必要 adapter requirement 时返回 adapter_incompatible。
```

### Policy & Capability Boundary

Policy 判断 runtime.target_action、debug_trace.upload 和外部动作边界。

Target World Adapter 执行结构校验并引用 PolicyDecision。

事实：

```text
Policy allow 不等于目标世界动作成功。
external_enforcement 必须显式声明。
```

### Evidence & Readiness

Target World Adapter 可以产生 validation_report。

Evidence & Readiness 判断该 report 是否支撑 DoD。

事实：

```text
validation report 不等于 readiness verdict。
adapter compatibility 不等于 ready_to_hatch。
```

### Agent Runtime Kernel

Agent Runtime Kernel 产生 runtime output 或需要目标世界 input。

Target World Adapter 归一化目标世界输入输出。

事实：

```text
Adapter 不运行 LLM/action loop。
Agent Runtime Kernel 不绕过 Adapter 执行目标世界动作。
```

### Debug & Feedback Bridge

Debug & Feedback Bridge 将 debug signal、runtime trace 和失败归因变成 feedback candidate。

Target World Adapter 只记录 debug signal 和 attribution hint。

事实：

```text
DebugSignal 不等于 FeedbackUnit。
目标世界私有内容默认不向上游传播。
```

## 不变量

```text
目标世界决定 runtime 形态。
dialogue 不是默认接口。
WorldInputEnvelope 不等于 message list。
WorldOutputEnvelope 不等于 action executed。
TargetActionRequest 不等于 action executed。
runtime.target_action 必须经过 PolicyDecision 或 external_enforcement。
Validation report 不等于 readiness verdict。
DebugSignal 不等于 feedback accepted。
Adapter 不运行 agent。
Adapter 不构建 hatch package。
Adapter 不修改 grow lifecycle。
目标世界私有内容默认不向上游传播。
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
adapter_incompatible
target_unavailable
target_action_rejected
target_validation_failed
external_enforcement_failed
runtime_output_invalid
debug_signal_blocked
```

事实：

```text
RuntimeContract 与目标世界不兼容时返回 contract_incompatible。
adapter retracted 或 unavailable 时返回 adapter_incompatible 或 target_unavailable。
policy deny 时 TargetActionRequest 不 dispatch。
目标世界拒绝动作时返回 target_action_rejected。
隐私不允许上传 debug signal 时返回 debug_signal_blocked 或 privacy_blocked。
```

## 验证要求

实现阶段应验证：

```text
dialogue_turn 不会被强制作为所有目标世界输入。
WorldInputEnvelope 不会直接成为 message list。
TargetActionRequest 没有 PolicyDecision 时不能 dispatch 高风险动作。
validation_report 不会直接触发 ready_to_hatch。
DebugSignal 不会直接生成 accepted feedback。
Adapter 不 import Agent Runtime Kernel loop。
Adapter 不创建 hatch_package artifact。
目标世界私有状态不会默认进入 upstream proposal。
```

## 开放问题

```text
目标世界 descriptor 的具体 schema 属于实现阶段。
第一阶段选择小说场景时，novel_project 的最小 input/output/action 集合需要单独收敛。
游戏 boss、小车和音乐 adapter 的实时性、重放和外部 enforcement 需要后续场景设计。
Target World Adapter 与具体宿主进程通信方式属于实现阶段或 adapter 插件设计。
```

这些问题不影响本模块当前终态事实：Target World Adapter 是目标世界输入、输出、动作、验证、失败和调试信号的边界适配层，不是对话接口、目标世界平台、runtime kernel 或 feedback admission 层。

