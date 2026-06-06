# Context & Message Compiler Spec

本文是 `Context & Message Compiler` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Context & Message Compiler` 是从 grow unit 的 file-native 事实投影出下一轮模型可见 message list 的编译器。

它产出 `compiled_message_list` artifact、compile report、source map、budget report 和 exclusion list。它不调用 LLM，不执行工具，不判断 readiness，不把 message list 当真相来源。

## 职责

该模块负责：

```text
收集 grow unit 当前可编译 summary。
构建 ContextCompilePlan。
选择本轮可见目标、DoD、缺口、材料、反馈、证据、skill 和 tool summary。
读取 artifact preview、summary 或受控片段。
按预算编译 provider-neutral message list。
生成 compiled_message_list artifact。
生成 source map。
生成 budget report。
生成 exclusion list。
生成 compile report。
记录 message list 编译事件。
解释某个 message list 的来源、排除和预算决策。
```

该模块不负责：

```text
LLM 调用。
provider request 发送。
工具执行。
工具输入校验。
输入和反馈准入。
skill activation。
skill 执行。
DoD 定义。
readiness verdict。
grow lifecycle 修改。
artifact lifecycle 判断。
hatch 打包。
runtime agent message list 编译。
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
  Admission & Feedback Inbox
  Agenda & DoD Manager

Used by:
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
Context Compiler 通过 Artifact Registry 读取 preview、summary、range 和 skill body materialization。
Context Compiler 通过 Artifact Registry 注册 compiled_message_list artifact。
Context Compiler 通过 Event Ledger 记录编译事件。
Context Compiler 读取 PolicyDecision 和 privacy metadata，但不执行 policy。
Context Compiler 不直接依赖 LLM Gateway 或 Tool Runtime。
```

## Compile Input

ContextCompileInput 是一次编译的输入快照。

它至少表达：

```text
growUnitSnapshot
admissionSummary
agendaSummary
attemptIntent
activeDoDRefs
openGapRefs
feedbackSummary
skillCandidateSummary
toolSurfaceSummary
policyBoundarySummary
artifactCandidateRefs
compileReason
correlationId
```

事实：

```text
compile input 是快照，不是真相来源。
compile input 只引用 summary 和 Ref，不内联大型内容。
toolSurfaceSummary 是只读工具面摘要，不表示工具可执行。
attemptIntent 不等于 message list。
```

## Compile Plan

ContextCompilePlan 描述本轮如何选择活跃表示。

CompilePlan 至少表达：

```text
compilePlanId
growUnitRef
attemptIntentRef
candidateSources
sectionPlan
priorityRules
budget
redactionRules
exclusionRules
skillVisibilityPlan
toolVisibilityPlan
source
audit
```

事实：

```text
CompilePlan 是编译决策，不是编译结果。
CompilePlan 不执行工具。
CompilePlan 不改变 Admission、Agenda 或 Skill 状态。
```

## Compiled Message List

CompiledMessageListRecord 是编译结果 record。

它至少表达：

```text
messageListId
messageListRef
growUnitRef
attemptIntentRef
compilePlanRef
artifactRef
providerNeutralMessages
sections
sourceMapRef
budgetReportRef
exclusionListRef
compileReportRef
contentHash
createdAt
source
version
audit
```

事实：

```text
CompiledMessageListRecord 指向 compiled_message_list artifact。
providerNeutralMessages 不是 provider request schema。
LLM Gateway 后续可以转换 providerNeutralMessages。
Message list 是活跃表示，不是真相来源。
每次编译产生新的 messageListId，不原地修改旧 message list。
```

## Sections

编译结果至少能表达以下 section 类别：

```text
core_invariants
grow_goal
target_world_summary
agenda_and_dod
admitted_materials
feedback_state
evidence_summary
visible_skills
visible_tools
policy_boundaries
attempt_intent
output_expectation
excluded_or_unavailable_summary
```

事实：

```text
section 是 provider-neutral 结构。
section 可以被 LLM Gateway 转成 provider messages。
section 必须有 source map。
section 缺失必须有 reason 或不适用说明。
```

## Source Map

SourceMap 记录每个可见片段来自哪里。

SourceMap entry 至少表达：

```text
messagePath
section
sourceType
sourceRef
sourceVersion
inclusionReason
transformation
redacted
truncated
policyDecisionId
contentHash
```

sourceType 至少包括：

```text
grow_unit_snapshot
admission_item
feedback_unit
agenda_item
dod_item
gap_record
artifact
skill
tool_surface
policy_decision
readiness_or_evidence_summary
manual_instruction
```

事实：

```text
任何非固定模板内容都有 source map。
摘要和片段必须能追溯到原始 ArtifactRef 或 summary。
redacted/truncated 必须显式记录。
```

## Budget Report

BudgetReport 表达本轮上下文预算。

它至少包含：

```text
budgetModel
totalBudget
sectionBudgets
estimatedUsage
overBudget
compressionApplied
truncationApplied
unavailableSources
```

事实：

```text
预算影响活跃表示，不改变事实层。
压缩摘要是派生表示，不替代原始 artifact。
预算不足时必须产生 exclusion record 或 truncation record。
```

## Exclusion List

ExclusionRecord 表达某个候选没有进入 message list 的原因。

原因至少包括：

```text
not_admitted
waiting_evidence
waiting_human
privacy_blocked
policy_blocked
redacted
retracted
archived
artifact_unavailable
out_of_budget
lower_priority
not_relevant_to_attempt_intent
incompatible_version
unsafe_tool_surface
```

事实：

```text
排除是编译事实，必须可解释。
排除不删除原始事实。
排除不改变 Admission 或 Artifact lifecycle。
```

## Skill and Tool Visibility

事实：

```text
active skill 不等于 visible skill。
visible skill 必须有 SkillRef、version、source 和 inclusionReason。
skill body materialization 必须通过 Skill Registry 和 Artifact Registry。
declaredCapabilities 不授予工具权限。
tool visible 不等于 tool executable。
visible tool 必须有 tool summary、capability summary、policy boundary summary 和 inclusionReason。
Context Compiler 不执行工具，不校验工具输入。
```

Context Compiler 不直接依赖 Tool Runtime。它使用 orchestration layer 提供的 `toolSurfaceSummary`，或后续 Tool Runtime 暴露的只读 summary contract。

## Ports

### Plan Port

```text
buildCompilePlan(input) -> Result<ContextCompilePlan>
explainCompilePlan(compilePlanRef) -> Result<CompilePlanExplanation>
```

事实：

```text
buildCompilePlan 不生成 message list。
CompilePlan 可用于 dry-run 和 CLI 解释。
```

### Compile Port

```text
compileMessageList(input) -> Result<MessageListRef>
recompileMessageList(previousMessageListRef, reason) -> Result<MessageListRef>
```

事实：

```text
compileMessageList 生成新的 compiled_message_list artifact。
recompile 不改写旧 message list。
编译失败不调用 LLM。
```

### Explanation Port

```text
explainMessageList(messageListRef) -> Result<MessageListExplanation>
readSourceMap(messageListRef) -> Result<SourceMap>
readBudgetReport(messageListRef) -> Result<BudgetReport>
readExclusionList(messageListRef) -> Result<ExclusionList>
```

事实：

```text
解释接口返回来源、预算、排除和转换信息。
解释接口不读取被 policy 阻断的原始内容。
```

## 事件

该模块写入 context/message-list 相关事件。事件可落在 grow_unit stream 下，或由 Event Ledger 在实现阶段提供 context stream。

事件类型至少包括：

```text
context_compile_plan_created
message_list_compiled
message_list_registered
message_list_invalidated
message_list_recompiled
context_source_excluded
context_budget_exceeded
context_compile_failed
```

事实：

```text
message_list_compiled 事件引用 compiled_message_list artifact。
大型 message list 内容不内联进事件。
source map、budget report、exclusion list 通过 ArtifactRef 或 MessageListRef 关联。
```

## 与其他模块的边界

### Artifact Registry

Artifact Registry 保存 compiled_message_list、preview、summary、source map 和 report。

Context Compiler 创建 compiled_message_list kind。

事实：

```text
Context Compiler 是 compiled_message_list kind 的 owning creator。
Artifact Registry 不决定哪些内容进入 message list。
```

### Admission & Feedback Inbox

Admission 决定输入和反馈准入状态。

Context Compiler 决定已准入内容是否进入本轮活跃表示。

事实：

```text
admitted 不等于 visible。
waiting_evidence、quarantined、redacted 必须影响 compile decision。
```

### Agenda & DoD Manager

Agenda 提供 AttemptIntent、DoD、gap 和 priority summary。

Context Compiler 编译这些内容的当前可见表示。

事实：

```text
AttemptIntent 不等于 message list。
DoD 不等于 readiness verdict。
```

### Skill Registry

Skill Registry 提供 skill candidate、summary 和 body materialization。

Context Compiler 决定本轮 visible skills。

事实：

```text
visible skill 必须写入 source map。
Context Compiler 不执行 skill。
```

### Policy & Capability Boundary

Policy 提供 policy decision 和 boundary summary。

Context Compiler 根据这些 summary 排除、脱敏或标记边界。

事实：

```text
Policy allow 不等于 tool executable。
privacy_blocked 内容不能进入 message list 原文。
```

### Grow Attempt Runner

Grow Attempt Runner 请求编译 message list，并使用 MessageListRef 执行 attempt。

Context Compiler 不执行 attempt。

### LLM Gateway

LLM Gateway 把 provider-neutral message list 转成 provider 请求并调用模型。

Context Compiler 不调用模型。

### Tool Runtime

Tool Runtime 管理工具定义、校验、执行和结果归档。

Context Compiler 只处理 tool visibility summary。

事实：

```text
Context Compiler 不 import Tool Runtime。
Tool Runtime 不决定本轮 message list。
```

## 不变量

```text
Message list 是 artifact。
Message list 是活跃表示，不是真相来源。
每次编译都要有 source map。
每次编译都要有 budget report。
排除、截断、脱敏必须显式记录。
Context Compiler 不调用 LLM。
Context Compiler 不执行工具。
Context Compiler 不判断 readiness。
Context Compiler 不决定输入准入。
Context Compiler 不改写 grow lifecycle。
active skill 不等于 visible skill。
tool visible 不等于 tool executable。
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
context_budget_exceeded
source_unavailable
source_retracted
skill_incompatible
tool_surface_incompatible
compile_conflict
```

事实：

```text
retracted source 不进入新 message list。
privacy_blocked source 不返回原文。
预算不足时返回 context_budget_exceeded 或生成带 exclusion 的成功结果。
source map 无法生成时编译失败。
```

## 验证要求

实现阶段应验证：

```text
compiled_message_list 只能由 Context Compiler 创建。
每个动态 section 都有 source map。
admitted item 不会自动进入 message list。
active skill 不会自动进入 message list。
tool visible 不会绕过 policy boundary。
redacted artifact 不会以原文进入 message list。
budget overflow 有 exclusion 或 truncation record。
编译过程不 import LLM Gateway 或 Tool Runtime。
recompile 不改写旧 message list artifact。
```

## 开放问题

```text
provider-neutral message 的最小结构需要与 LLM Gateway spec 联合收敛。
预算估算模型需要等 LLM Gateway 的 provider 能力摘要后校准。
ToolSurfaceSummary 的最终来源需要等 Tool Runtime spec 确认。
runtime agent 的 message list 由 Agent Runtime Kernel 生成 runtime_message_list artifact，不属于本模块。
```

这些问题不影响本模块当前终态事实：Context & Message Compiler 是 file-native 事实到下一轮模型活跃表示的编译器，不是 LLM 调用器、工具执行器或事实来源。
