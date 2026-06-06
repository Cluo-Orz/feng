# Agenda & DoD Manager Spec

本文是 `Agenda & DoD Manager` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Agenda & DoD Manager` 管理 grow 的目标拆解、缺口、阻塞项、Definition of Done、验证意图和下一轮 attempt 建议。

它让 feng 能解释“为什么下一轮要做这件事”和“什么证据才算接近成了”。它不是 Todo 工具，不执行 attempt，不判断最终 readiness。

## 职责

该模块负责：

```text
维护 AgendaRecord。
维护 AgendaItem。
维护 GapRecord。
定义和修订 DoDItem。
记录验证意图和 evidence requirement。
根据准入输入、反馈 summary、grow state 和验证结果提出 agenda 变更候选。
生成下一轮 AttemptIntent。
记录阻塞、等待输入、等待验证和重试边界。
提供 AgendaSummary 给 Grow Unit Manager、Context Compiler、Grow Attempt Runner 和 CLI。
记录 agenda/dod/gap lifecycle 事件。
```

该模块不负责：

```text
LLM 调用。
工具执行。
message list 编译。
attempt turn loop。
readiness verdict。
证据充分性最终判断。
grow lifecycle 修改。
输入和反馈准入。
artifact 内容保存。
hatch package 构建。
runtime contract 定义。
用户项目管理 UI。
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

Used by:
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
Agenda 通过 Event Ledger 写入 agenda/dod/gap 相关事件。
Agenda 通过 Artifact Registry 引用大目标说明、验证报告、反馈证据和外部材料。
Agenda 读取 AdmissionSummary 作为输入候选来源。
Agenda 读取 GrowUnitStateSnapshot 作为当前生命周期背景。
Agenda 可以读取 Skill Registry summary，但不加载 skill body。
Agenda 不直接改 Grow Unit lifecycle。
```

## Agenda Record

AgendaRecord 是当前 grow 议程的投影视图。

AgendaRecord 至少表达：

```text
agendaId
growUnitRef
goalBoundarySummary
currentFocus
agendaItemRefs
gapRefs
dodRefs
attemptIntentRef
latestEvaluationRefs
recommendedGrowState
source
version
audit
```

事实：

```text
AgendaRecord 是 projection，不是真相来源。
AgendaRecord 可从 agenda 事件重建。
recommendedGrowState 是建议，不直接修改 grow lifecycle。
currentFocus 不等于 message list。
```

## Agenda Item

AgendaItem 表达当前要推进的目标片段、缺口、候选或验证点。

AgendaItem 至少表达：

```text
agendaItemId
growUnitRef
kind
status
summary
reason
inputRefs
relatedGapRefs
relatedDoDRefs
expectedOutput
evidenceRequirementRefs
attemptIntentRefs
priority
retryPolicy
source
audit
```

kind 至少包括：

```text
clarify_goal
collect_material
define_target_world
define_runtime_contract
produce_candidate
inspect_feedback
validate_candidate
revise_skill_or_context
prepare_hatch
resolve_privacy_or_policy
```

status 至少包括：

```text
proposed
active
waiting_input
waiting_policy
waiting_feedback
waiting_validation
blocked
completed_for_now
rejected
superseded
retired
```

事实：

```text
completed_for_now 不等于 readiness passed。
proposed 不等于 active。
blocked 可以建议 Grow Unit Manager 进入 blocked 或 waiting_input。
retryPolicy 用于防止同一缺口无限重试。
```

## Gap Record

GapRecord 表达阻塞 grow 的缺口。

GapRecord 至少表达：

```text
gapId
growUnitRef
kind
status
summary
requiredInput
requiredEvidence
blockingReason
relatedAdmissionRefs
relatedFeedbackRefs
relatedPolicyDecisionRefs
attemptCount
retryLimit
source
audit
```

kind 至少包括：

```text
missing_goal_boundary
missing_material
missing_permission
missing_policy_decision
missing_validation_environment
target_world_contract_incomplete
runtime_contract_incomplete
candidate_failure
evidence_insufficient
privacy_unknown
version_incompatible
```

status 至少包括：

```text
open
waiting_input
waiting_policy
waiting_validation
retrying
blocked
resolved_for_now
rejected
superseded
```

事实：

```text
resolved_for_now 不等于 readiness passed。
缺口连续失败达到 retryLimit 后必须进入 blocked 或 waiting_input 建议。
缺材料时 Agenda 记录最小 requiredInput，而不是推动继续编造。
```

## DoD Item

DoDItem 表达完成条件和需要的证据类型。

DoDItem 至少表达：

```text
dodId
growUnitRef
statement
scope
evidenceRequirement
validationIntent
targetWorldSummaryRef
relatedAgendaItemRefs
relatedGapRefs
latestEvaluationRef
lifecycle
source
version
audit
```

lifecycle 至少包括：

```text
proposed
active
blocked
retired
superseded
incompatible
```

事实：

```text
DoDItem 定义要证明什么。
DoDItem 不判断是否已经证明。
latestEvaluationRef 由 Evidence & Readiness 或验证报告产生。
DoDItem 的变更必须保留版本、来源和 reason。
```

## Attempt Intent

AttemptIntent 表达下一轮 grow attempt 的目的和约束。

AttemptIntent 至少表达：

```text
attemptIntentId
growUnitRef
purpose
focusAgendaItemRefs
inputCandidateRefs
requiredContextRefs
visibleSkillScopeSummary
toolNeedSummary
policyBoundarySummary
expectedOutputs
expectedEvidence
stopCondition
source
audit
```

事实：

```text
AttemptIntent 不是 attempt。
AttemptIntent 不包含编译后的 message list。
Context & Message Compiler 根据 AttemptIntent 和其他事实编译 message list。
Grow Attempt Runner 执行 attempt。
```

## Ports

### Agenda Port

```text
createAgenda(growUnitRef, input) -> Result<AgendaRef>
getAgenda(growUnitRef) -> Result<AgendaRecord>
proposeAgendaItem(growUnitRef, input) -> Result<AgendaItemRef>
activateAgendaItem(agendaItemRef, reason) -> Result<AgendaReceipt>
updateAgendaItem(agendaItemRef, update) -> Result<AgendaReceipt>
retireAgendaItem(agendaItemRef, reason) -> Result<AgendaReceipt>
```

事实：

```text
propose 不等于 active。
activate、update、retire 都写事件。
Agenda item 变更不直接改 grow lifecycle。
```

### Gap Port

```text
recordGap(growUnitRef, input) -> Result<GapRef>
updateGap(gapRef, update) -> Result<GapReceipt>
resolveGapForNow(gapRef, reason) -> Result<GapReceipt>
listOpenGaps(growUnitRef, query) -> Result<GapPage>
```

事实：

```text
resolveGapForNow 不表示 DoD 满足。
gap 的 requiredInput 可用于 CLI 最小提问。
retryLimit 防止无限 grow。
```

### DoD Port

```text
defineDoD(growUnitRef, input) -> Result<DoDRef>
reviseDoD(dodRef, revision) -> Result<DoDReceipt>
retireDoD(dodRef, reason) -> Result<DoDReceipt>
linkDoDEvaluation(dodRef, evaluationRef) -> Result<DoDReceipt>
listActiveDoD(growUnitRef) -> Result<DoDList>
```

事实：

```text
defineDoD 写入 DoD 定义事件。
linkDoDEvaluation 只链接外部评价，不生成 verdict。
retireDoD 保留历史定义。
```

### Attempt Intent Port

```text
buildAttemptIntent(growUnitRef, options) -> Result<AttemptIntentRef>
explainAttemptIntent(attemptIntentRef) -> Result<AttemptIntentExplanation>
```

事实：

```text
AttemptIntent 说明下一轮为什么存在。
AttemptIntent 不执行 attempt。
AttemptIntent 不编译 message list。
```

### Summary Port

```text
buildAgendaSummary(growUnitRef, options) -> Result<AgendaSummary>
explainAgendaState(growUnitRef) -> Result<AgendaExplanation>
```

事实：

```text
AgendaSummary 可用于 CLI、Grow Unit Manager、Context Compiler 和 Grow Attempt Runner。
AgendaSummary 不包含完整大内容。
explanation 说明当前重点、缺口、DoD 和下一步意图来自哪些事件和输入。
```

## 事件

该模块写入 agenda 相关事件。事件可以落在 grow_unit stream 下，或由 Event Ledger 在实现阶段提供 agenda stream。

事件类型至少包括：

```text
agenda_created
agenda_item_proposed
agenda_item_activated
agenda_item_updated
agenda_item_blocked
agenda_item_retired
gap_recorded
gap_updated
gap_resolved_for_now
dod_defined
dod_revised
dod_retired
dod_evaluation_linked
attempt_intent_created
agenda_summary_updated
agenda_decision_superseded
```

事实：

```text
事件 payload 保存 summary 和 Ref，不内联大型材料。
DoD 修订不改写历史 DoD。
纠错通过 superseding event。
```

## 与其他模块的边界

### Grow Unit Manager

Grow Unit Manager 拥有 grow lifecycle。

Agenda 提供 AgendaSummary 和 recommendedGrowState。

事实：

```text
Agenda 不直接改 grow lifecycle。
recommendedGrowState 是建议。
```

### Admission & Feedback Inbox

Admission 提供已准入输入、反馈候选和上游提议 summary。

Agenda 可基于这些 summary 生成 agenda/gap/DoD 候选。

事实：

```text
accepted_local 不自动改 active DoD。
feedback candidate 可提出 agenda candidate，但不自动成为 active agenda。
```

### Context & Message Compiler

Context Compiler 编译 message list。

Agenda 提供 AttemptIntent、active DoD、open gaps 和 priority summary。

事实：

```text
Agenda 不拼接 prompt。
AttemptIntent 不等于 message list。
```

### Grow Attempt Runner

Grow Attempt Runner 执行 attempt。

Agenda 提供下一轮 attempt 的 intent。

事实：

```text
AttemptIntent 不等于 attempt lifecycle。
attempt 失败可以回流为 gap update，但不由 Agenda 执行。
```

### Evidence & Readiness

Evidence & Readiness 判断 DoD satisfaction 和 readiness verdict。

Agenda 定义 DoD 和链接 evaluationRef。

事实：

```text
DoDItem 不产生 readiness verdict。
Gap resolved 不等于 hatch ready。
```

### Skill Registry

Skill Registry 管理 skill activation。

Agenda 可引用 skill scope summary 作为 AttemptIntent 背景。

事实：

```text
Agenda 不加载 skill body。
Agenda 不决定 skill 本轮可见性。
```

## 不变量

```text
Todo 不是证据。
DoD 不是 readiness verdict。
AttemptIntent 不是 attempt。
AttemptIntent 不是 message list。
Gap resolved 不等于 hatch ready。
Agenda 不调用 LLM。
Agenda 不执行工具。
Agenda 不改 grow lifecycle。
Agenda 不判断最终证据充分性。
DoD 修订必须保留历史版本。
同一缺口不能无限重试。
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
version_unsupported
schema_incompatible
artifact_unavailable
agenda_conflict
dod_incompatible
gap_conflict
attempt_intent_blocked
retry_limit_reached
```

事实：

```text
缺少 growUnitRef 时返回 invalid_input。
active DoD 与当前目标世界不兼容时返回 dod_incompatible。
同一缺口重复创建且无 supersede reason 时返回 gap_conflict。
达到 retryLimit 时返回 retry_limit_reached 并建议 blocked 或 waiting_input。
```

## 验证要求

实现阶段应验证：

```text
DoDItem 不生成 readiness verdict。
AttemptIntent 不包含 message list 内容。
Agenda item completed_for_now 不会触发 ready_to_hatch。
feedback candidate 不自动生成 active agenda。
DoD 修订保留历史版本。
retryLimit 达到后不再继续生成同类 AttemptIntent。
Context Compiler 之外不能把 AgendaSummary 当 message list。
Evidence & Readiness 之外不能标记 DoD 满足 verdict。
```

## 开放问题

```text
agenda 事件是否需要独立 stream，需要与 Event Ledger 实现阶段共同判断。
DoD 的验证意图结构需要与 Evidence & Readiness、Target World Adapter 联合收敛。
AttemptIntent 的最小字段需要等 Context & Message Compiler 和 Grow Attempt Runner spec 完成后校准。
CLI 如何展示缺口而不变成项目管理界面，需要等 CLI spec 确认。
```

这些问题不影响本模块当前终态事实：Agenda & DoD Manager 是目标拆解、缺口、DoD 和下一轮 attempt 意图的 owning module，不是 Todo 工具、message compiler 或 readiness 裁判。
