# Runtime Contract Registry Spec

本文是 `Runtime Contract Registry` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Runtime Contract Registry` 是 hatch 产物运行契约的登记、版本、完整性验证、锁定和解释层。

它保证每个可复制能力包都有明确运行边界：输入、输出或事件、运行内核类型、动作边界、调试接口、反馈入口、失败处理、观测方式和版本兼容。

它不实现 runtime，不构建 hatch package，不运行目标世界，也不把所有产物压成同一种 agent。

## 职责

该模块负责：

```text
登记 runtime contract candidate。
管理 RuntimeContractRecord。
创建 runtime_contract artifact。
管理 contract lifecycle。
管理 contract version。
表达 runtime kernel type。
表达 input contract。
表达 output/event contract。
表达 action boundary contract。
表达 debug contract。
表达 feedback contract。
表达 failure contract。
表达 observability contract。
表达 version compatibility。
校验 contract completeness。
校验 contract 与 readiness/evidence 的关系。
lock contract for hatch。
解释 contract 的运行边界、风险和兼容性。
记录 runtime contract 事件。
```

该模块不负责：

```text
生成 grow 目标。
判断 readiness。
构建 hatch package。
选择 hatch package 文件。
执行 runtime。
实现 Agent Runtime Kernel。
实现 Target World Adapter。
执行目标世界动作。
编译 runtime message list。
执行工具。
调用 LLM。
发送 feedback。
采纳 feedback。
保存 secret。
提供插件市场。
定义最终目录 schema。
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
  Evidence & Readiness

Used by:
  Context & Message Compiler
  Hatch Builder
  Target World Adapter
  Agent Runtime Kernel
  Debug & Feedback Bridge
  CLI
```

事实：

```text
Runtime Contract Registry 通过 Artifact Registry 创建 runtime_contract artifact。
Runtime Contract Registry 通过 Event Ledger 写入 contract lifecycle 和 version 事件。
Runtime Contract Registry 通过 Policy 判断 contract export、publish、capability、target action 和 debug/feedback 边界。
Runtime Contract Registry 读取 Evidence & Readiness 的 verdict、DoD evaluation 和 evidence summary。
Runtime Contract Registry 可以读取 Skill Registry 的 skill summary，但不加载 skill body 到 contract 原文。
Runtime Contract Registry 不直接依赖 Hatch Builder、Agent Runtime Kernel、Target World Adapter 或 Debug & Feedback Bridge。
```

## Runtime Contract Record

RuntimeContractRecord 是一个 hatch 产物可运行边界的业务事实。

它至少表达：

```text
runtimeContractId
runtimeContractRef
growUnitRef
hatchPackageRef
name
version
lifecycle
runtimeKernelType
targetWorldSummaryRef
inputContractRef
outputContractRef
eventContractRef
actionBoundaryRef
debugContractRef
feedbackContractRef
failureContractRef
observabilityContractRef
compatibilityRef
capabilityRequirementRefs
policyDecisionRefs
evidenceRefs
artifactRef
createdAt
updatedAt
source
audit
```

事实：

```text
RuntimeContractRecord 是 projection，不是真相来源。
RuntimeContractRecord 可由 contract stream 重建。
artifactRef 指向 runtime_contract artifact。
hatchPackageRef 在 package 构建前可以为空。
runtimeContractRef 不等于 hatchPackageRef。
```

## Lifecycle

contract lifecycle 至少包括：

```text
candidate
registered
validated
verification_failed
locked_for_hatch
packaged
active
deprecated
retracted
superseded
incompatible
```

事实：

```text
candidate 表示从 grow 输出或人工输入得到的 contract 候选。
registered 表示 registry 已登记版本。
validated 表示结构完整性通过。
verification_failed 表示 contract 与证据、policy 或目标世界边界不一致。
locked_for_hatch 表示该版本可供 Hatch Builder 使用。
packaged 表示已被某个 hatch package 引用。
active 表示该 contract version 是某个 runtime 的当前声明。
retracted 表示不能用于未来 hatch 或 runtime。
superseded 表示已有替代版本。
incompatible 表示当前环境或目标世界不支持。
```

## Runtime Kernel Type

runtimeKernelType 使用 Domain Model & Contracts 的 kernel type：

```text
standard_agent_kernel
custom_agent_kernel
non_llm_runtime
hybrid_runtime
```

事实：

```text
kernel type 是运行形态声明，不是实现。
standard_agent_kernel 表示可由 Agent Runtime Kernel 默认底座运行。
custom_agent_kernel 表示需要 hatch package 自带特定 agent runtime。
non_llm_runtime 表示不依赖 LLM loop，但仍遵守 contract。
hybrid_runtime 表示组合 LLM、工具、脚本、服务或目标世界组件。
kernel type 不强制所有 contract 支持对话。
```

## Input Contract

InputContract 表达 runtime 如何被调用。

它至少包含：

```text
inputContractId
runtimeContractRef
inputModes
inputSchemas
stateSnapshotRequirements
artifactInputRules
dialogueInputSupport
streamingInputSupport
batchInputSupport
timingSemantics
privacyRules
source
audit
```

inputModes 至少包括：

```text
command_args
file_material
event
state_snapshot
tick_state
dialogue_turn
sensor_frame
batch_job
external_service_request
```

事实：

```text
dialogue_turn 是可选 input mode，不是默认要求。
state_snapshot 和 tick_state 服务游戏、小车、模拟器等目标世界。
artifactInputRules 必须声明允许读取哪些 artifact kind 和隐私边界。
InputContract 不读取输入内容。
```

## Output and Event Contract

OutputContract 表达 runtime 输出什么。

它至少包含：

```text
outputContractId
runtimeContractRef
outputModes
outputSchemas
eventSchemas
artifactOutputRules
actionOutputRules
streamingOutputSupport
partialOutputSemantics
privacyRules
source
audit
```

outputModes 至少包括：

```text
text_result
structured_result
file_artifact
action_event
decision_event
control_command
patch_candidate
chapter_output
music_fragment
debug_event
feedback_candidate
```

事实：

```text
OutputContract 不执行输出动作。
action_event 和 control_command 需要 ActionBoundaryContract 和 Policy 支持。
feedback_candidate 输出不等于 feedback accepted。
```

## Action Boundary Contract

ActionBoundaryContract 表达 runtime 可以影响外界的动作边界。

它至少包含：

```text
actionBoundaryId
runtimeContractRef
allowedActionKinds
forbiddenActionKinds
requiredCapabilities
targetWorldActionSummary
externalServiceSummary
fileAccessSummary
networkAccessSummary
humanApprovalRequirements
policyDecisionRefs
boundaryDeclaration
source
audit
```

事实：

```text
ActionBoundaryContract 是声明，不执行动作。
runtime.target_action 必须经 Policy & Capability Boundary 判断。
Policy allow 不等于目标世界动作已执行。
目标世界动作的具体归一化由 Target World Adapter 完成。
```

## Debug Contract

DebugContract 表达 runtime 如何在调试模式下暴露可观察信息。

它至少包含：

```text
debugContractId
runtimeContractRef
debugModes
traceLevel
traceEventKinds
correlationRules
messageListExposureRules
toolResultExposureRules
targetWorldStateExposureRules
privacyRules
uploadPolicyRequirement
source
audit
```

debugModes 至少包括：

```text
off
local_trace
developer_debug
feedback_reporting
upstream_proposal
```

事实：

```text
DebugContract 只声明调试接口。
DebugContract 不上传 trace。
debug_trace.upload 由 Policy 判断。
Debug & Feedback Bridge 负责按 contract 生成反馈候选和上报包。
```

## Feedback Contract

FeedbackContract 表达 runtime 如何形成反馈候选。

它至少包含：

```text
feedbackContractId
runtimeContractRef
feedbackEntryKinds
feedbackUnitShape
attributionRules
originLayerRules
targetLayerRules
evidenceRequirements
redactionRules
upstreamProposalRules
defaultFeedbackRouterCompatibility
policyDecisionRefs
source
audit
```

事实：

```text
FeedbackContract 声明反馈入口，不发送反馈。
反馈候选必须进入 Admission & Feedback Inbox。
upstream proposal 需要 PolicyDecision。
default_feedback_router compatibility 不表示反馈自动上游吸收。
```

## Failure Contract

FailureContract 表达 runtime 失败、暂停、超时和降级方式。

它至少包含：

```text
failureContractId
runtimeContractRef
errorCodes
retryability
timeoutSemantics
cancellationSemantics
partialResultSemantics
fallbackSemantics
recoveryRequirements
traceRequirements
source
audit
```

事实：

```text
FailureContract 是宿主可处理失败的约定。
失败处理不等于自动 retry。
生产 runtime 失败不能直接改 grow state。
```

## Observability Contract

ObservabilityContract 表达 runtime 如何被观察和审计。

它至少包含：

```text
observabilityContractId
runtimeContractRef
requiredTraceRefs
runtimeTraceKinds
metricSummaries
eventCorrelationRules
artifactRetentionRules
privacyRules
source
audit
```

事实：

```text
ObservabilityContract 不创建 runtime_trace。
Agent Runtime Kernel、Target World Adapter 或 Debug & Feedback Bridge 后续按该 contract 产生 trace。
```

## Version Compatibility

VersionCompatibility 表达 contract 版本兼容边界。

它至少包含：

```text
compatibilityId
runtimeContractRef
version
compatibleWith
breakingChanges
migrationNotes
rollbackTarget
deprecationPolicy
source
audit
```

事实：

```text
contract version 不可原地修改。
contract 内容变化产生新 version。
locked_for_hatch 后不能原地编辑。
rollback 通过选择旧 version 或新 superseding event 表达。
```

## Completeness and Verification

ContractCompletenessCheck 至少检查：

```text
runtimeKernelType 已声明。
input contract 已声明。
output 或 event contract 已声明。
failure contract 已声明。
debug contract 已声明。
feedback contract 已声明。
action boundary 已声明。
requiredCapabilities 已声明。
privacy rules 已声明。
version compatibility 已声明。
必要 evidenceRefs 可读。
policy blockers 已解释。
```

事实：

```text
validated 表示 contract 结构完整，不表示 ready_to_hatch。
locked_for_hatch 需要结构完整、版本明确、必要 evidence 可读且无 policy blocker。
ready_to_hatch verdict 是输入条件之一，但不自动锁定 contract。
contract locked_for_hatch 不等于 hatch package 已构建。
```

## Ports

### Registry Port

```text
recordContractCandidate(input) -> Result<RuntimeContractRef>
registerRuntimeContract(input) -> Result<RuntimeContractRef>
getRuntimeContract(runtimeContractRef) -> Result<RuntimeContractRecord>
listRuntimeContracts(query) -> Result<RuntimeContractPage>
materializeRuntimeContract(runtimeContractRef, options) -> Result<RuntimeContractMaterialization>
```

事实：

```text
candidate 不等于 registered。
registered 不等于 validated。
materialize 通过 Artifact Registry 读取 runtime_contract artifact。
```

### Version Port

```text
addRuntimeContractVersion(runtimeContractRef, input) -> Result<RuntimeContractRef>
compareRuntimeContractVersions(a, b) -> Result<RuntimeContractDiffSummary>
deprecateRuntimeContract(runtimeContractRef, reason) -> Result<RuntimeContractReceipt>
retractRuntimeContract(runtimeContractRef, reason) -> Result<RuntimeContractReceipt>
```

事实：

```text
新版本保留 source、evidenceRefs、policyDecisionRefs 和 audit。
retract 不删除历史 record。
deprecated version 可继续被已发布 package 引用，但不用于新 hatch。
```

### Verification Port

```text
validateRuntimeContract(runtimeContractRef) -> Result<ContractCompletenessReport>
verifyRuntimeContractForHatch(runtimeContractRef, readinessVerdictRef) -> Result<ContractVerificationReport>
lockRuntimeContractForHatch(runtimeContractRef, reason) -> Result<RuntimeContractReceipt>
```

事实：

```text
validate 只检查结构和引用完整性。
verify 读取 readiness verdict、evidence summary、policy 和 artifact metadata。
lock 写入 lifecycle 事件。
lock 不构建 hatch package。
```

### Summary Port

```text
buildRuntimeContractSummary(runtimeContractRef, options) -> Result<RuntimeContractSummary>
explainRuntimeContract(runtimeContractRef) -> Result<RuntimeContractExplanation>
explainCompatibility(runtimeContractRef, targetVersion) -> Result<CompatibilityExplanation>
```

事实：

```text
summary 可被 Context Compiler、Hatch Builder、Agent Runtime Kernel、Target World Adapter、Debug & Feedback Bridge 和 CLI 使用。
summary 不包含 secret 原文。
explanation 说明输入、输出、动作、调试、反馈、失败和版本边界。
```

## 事件

该模块写入 runtime_contract 相关事件。事件可落在 grow_unit stream 下，或由 Event Ledger 在实现阶段提供 runtime_contract stream。

事件类型至少包括：

```text
runtime_contract_candidate_recorded
runtime_contract_registered
runtime_contract_version_added
runtime_contract_validated
runtime_contract_verification_failed
runtime_contract_locked_for_hatch
runtime_contract_linked_to_hatch_package
runtime_contract_deprecated
runtime_contract_retracted
runtime_contract_superseded
runtime_contract_incompatible
```

事实：

```text
事件 payload 保存 summary、Ref、version、lifecycle 和 policyDecisionId，不内联大型 contract artifact。
contract artifact 由 Artifact Registry 保存。
纠错通过 superseding event，不改写旧 contract 版本。
```

## 与其他模块的边界

### Evidence & Readiness

Evidence & Readiness 给出 readiness verdict、DoD evaluation 和 evidence summary。

Runtime Contract Registry 用这些事实验证 contract 是否可 lock for hatch。

事实：

```text
ready_to_hatch 不等于 contract locked。
contract validated 不等于 readiness passed。
```

### Hatch Builder

Hatch Builder 构建 hatch package。

Runtime Contract Registry 提供 locked runtime contract。

事实：

```text
Runtime Contract Registry 不选择 package 文件。
Runtime Contract Registry 不创建 hatch_package artifact。
Hatch Builder 不能用 retracted 或 incompatible contract 构建新 package。
```

### Agent Runtime Kernel

Agent Runtime Kernel 消费 standard_agent_kernel、custom_agent_kernel 或 hybrid_runtime 中的 agent contract 部分。

Runtime Contract Registry 只记录 contract。

事实：

```text
Runtime Contract Registry 不编译 runtime message list。
standard_agent_kernel contract 不等于 prompt wrapper。
```

### Target World Adapter

Target World Adapter 归一化目标世界输入、动作、验证和失败映射。

Runtime Contract Registry 声明 target world boundary 和 adapter requirement。

事实：

```text
目标世界决定 contract 形态。
Registry 不实现目标世界 adapter。
```

### Debug & Feedback Bridge

Debug & Feedback Bridge 根据 DebugContract 和 FeedbackContract 生成 trace 上报、feedback unit 和 upstream proposal。

Runtime Contract Registry 只声明接口和边界。

事实：

```text
FeedbackContract 不发送反馈。
反馈仍进入 Admission & Feedback Inbox。
```

### Policy & Capability Boundary

Policy 判断 contract 中声明的 capability、publish、debug upload、feedback upstream 和 runtime.target_action 边界。

Runtime Contract Registry 记录 policyDecisionId。

事实：

```text
Policy allow 不等于 contract 已验证。
contains_secret 不得进入 runtime_contract artifact 原文。
```

### Artifact Registry

Artifact Registry 保存 runtime_contract artifact。

Runtime Contract Registry 拥有 contract lifecycle 和版本语义。

事实：

```text
runtime_contract artifact 不等于 hatch_package artifact。
artifact registration 不等于 contract validated。
```

## 不变量

```text
每个 hatch package 必须引用 RuntimeContractRef。
RuntimeContractRef 不等于 HatchPackageRef。
runtime_contract artifact 不等于 hatch package。
contract version 不可原地修改。
locked_for_hatch 后不能原地编辑。
kernel type 不强制所有产物是 LLM agent。
dialogue input 不是默认 contract 要求。
contract 声明 feedback entry，不发送 feedback。
contract 声明 action boundary，不执行 action。
contract validated 不等于 ready_to_hatch。
ready_to_hatch 不等于 contract packaged。
contract 不包含 secret 原文。
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
contract_incomplete
contract_incompatible
contract_retracted
contract_not_ready
readiness_missing
evidence_unavailable
capability_unsupported
```

事实：

```text
缺少 runtimeKernelType 时返回 contract_incomplete。
缺少 feedback 或 debug contract 时返回 contract_incomplete。
readinessVerdictRef 不存在时不能 lock_for_hatch。
retracted contract 不能用于新 hatch。
contains_secret 出现在 contract artifact 原文时返回 privacy_blocked。
要求 unsupported capability 时返回 capability_unsupported 或 policy_blocked。
```

## 验证要求

实现阶段应验证：

```text
runtime_contract artifact 只能由 Runtime Contract Registry 创建。
contract version 不能原地修改。
locked_for_hatch contract 不能被编辑。
缺 input/output/failure/debug/feedback/action boundary 任一关键部分时不能 validated。
ready_to_hatch verdict 不会自动生成 hatch package。
non_llm_runtime contract 不需要 Agent Runtime Kernel。
dialogue input 不会被强制写入所有 contract。
FeedbackContract 不会绕过 Admission 创建 accepted feedback。
contains_secret 不进入 runtime_contract artifact 原文。
```

## 开放问题

```text
Runtime contract artifact 的具体 schema 属于实现阶段。
contract version 是否采用 semver 或内容 hash 组合，需要实现阶段确认。
TargetWorldSummaryRef 的最小结构需要等 Target World Adapter spec 收敛。
standard_agent_kernel contract 与 Agent Runtime Kernel message list 编译边界需要等 Agent Runtime Kernel spec 确认。
```

这些问题不影响本模块当前终态事实：Runtime Contract Registry 是 hatch 产物运行契约的登记、版本、完整性验证、锁定和解释层，不是 hatch builder、runtime implementation、目标世界 adapter 或 agent 模板中心。

