# Grow Unit Manager Spec

本文是 `Grow Unit Manager` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Grow Unit Manager` 是一个智能行为连续成长空间的业务协调中心。它拥有 grow unit identity、lifecycle、目标边界摘要、当前阶段、关键引用和生命周期事件。

它不是会话管理器，不是 LLM loop，不是 prompt 编译器，也不是 Grow Kernel 的全部大脑。

## 职责

该模块负责：

```text
创建 grow unit。
打开和描述 grow unit。
维护 grow unit lifecycle。
维护 grow unit 的目标边界 summary。
维护当前阶段和关键模块引用。
协调 Admission、Agenda、Attempt、Readiness、Hatch 的生命周期结果。
记录 grow_unit stream 事件。
提供可恢复的 grow unit state snapshot。
归档、冻结或阻塞 grow unit。
维护 grow unit 下唯一连续成长轨迹的边界。
```

该模块不负责：

```text
用户可见 session。
聊天历史保存。
输入和反馈准入。
DoD 设计与缺口管理。
message list 编译。
LLM 调用。
工具执行。
attempt turn loop。
readiness 判断。
hatch package 构建。
runtime contract 定义。
目标世界 adapter。
feedback 采纳状态转换。
具体 .feng 目录 schema。
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
  Admission & Feedback Inbox
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
Grow Unit Manager 通过 Event Ledger 记录 grow lifecycle。
Grow Unit Manager 通过 Artifact Registry 引用大型目标说明、摘要、trace、message list 和验证报告。
Grow Unit Manager 通过 Policy 处理 archive、freeze、delete-like 或跨边界操作的决策。
Grow Unit Manager 可读取 Skill Registry 的默认 skill scope summary，但不加载 skill body。
```

## Grow Unit Record

每个 grow unit 都有一个 GrowUnitRecord。

GrowUnitRecord 至少表达：

```text
growUnitId
growUnitRef
workspace
lifecycle
title
goalBoundarySummary
targetBehaviorSummary
targetWorldSummaryRef
currentPhase
activeAttemptRef
latestMessageListRef
latestReadinessVerdictRef
latestValidationReportRef
latestHatchPackageRef
admissionInboxRef
agendaRef
skillScopeRef
policyScopeRef
createdAt
updatedAt
source
version
audit
```

事实：

```text
GrowUnitRecord 是当前投影视图，不是真相来源。
GrowUnitRecord 可由 grow_unit stream 重建。
大型目标材料、目标世界说明、message list 和验证报告通过 Ref 表达。
goalBoundarySummary 是目标边界摘要，不替代 Agenda/DoD。
latestMessageListRef 是引用，不表示 Manager 编译了 message list。
```

## Lifecycle

Grow Unit Manager 使用 Domain Model & Contracts 的 grow lifecycle 状态。

状态至少包括：

```text
created
clarifying
planning
growing
waiting_input
waiting_feedback
verifying
ready_to_hatch
hatched
blocked
archived
```

事实：

```text
created 表示 grow unit 已建立。
clarifying 表示目标或边界缺关键澄清。
planning 表示 Agenda/DoD 正在形成。
growing 表示可以进行 grow attempt。
waiting_input 表示缺材料、权限、确认或目标边界。
waiting_feedback 表示等待运行环境、debug trace 或下游反馈。
verifying 表示证据正在被验证。
ready_to_hatch 表示 Evidence & Readiness 已给出可 hatch verdict。
hatched 表示已有 hatch package 关联。
blocked 表示当前无法可靠推进。
archived 表示该 grow unit 不再参与常规 grow。
```

状态转换事实：

```text
状态转换必须写入 grow_unit stream。
状态转换必须有 reason、source、audit、correlationId 和 causationId。
Manager 可以根据其他模块结果推进状态，但不替其他模块做判断。
未知或不兼容状态不得静默映射为 growing。
```

## No User-Facing Session

feng 不暴露用户需要理解的 session 概念。

事实：

```text
GrowUnit 是唯一顶层成长边界。
同一个 GrowUnit 下只有一个连续成长轨迹。
attempt 是执行片段，不是 session。
wake reason 是事件来源，不是 session。
runtime debug trace 是反馈来源，不是 session。
message list 是编译产物，不是 session history。
```

实现内部不得把 Session 作为跨模块业务类型暴露。若宿主层为了 provider 或进程恢复需要临时运行标识，该标识不得进入用户心智、grow unit contract 或 message list 来源说明中的顶层概念。

## Ports

### Lifecycle Port

```text
createGrowUnit(input) -> Result<GrowUnitRef>
openGrowUnit(workspace) -> Result<GrowUnitStateSnapshot>
getGrowUnit(growUnitRef) -> Result<GrowUnitRecord>
transitionGrowUnit(growUnitRef, transition) -> Result<GrowUnitTransitionReceipt>
archiveGrowUnit(growUnitRef, reason) -> Result<GrowUnitTransitionReceipt>
blockGrowUnit(growUnitRef, reason) -> Result<GrowUnitTransitionReceipt>
unblockGrowUnit(growUnitRef, reason) -> Result<GrowUnitTransitionReceipt>
```

事实：

```text
createGrowUnit 写入 grow_unit_created 事件。
openGrowUnit 读取投影和关键引用，不创建 session。
transitionGrowUnit 校验当前状态和目标状态。
archive、block、unblock 都写入事件。
需要权限或确认的 transition 先取得 PolicyDecision。
```

### Coordination Port

```text
linkAdmissionState(growUnitRef, admissionSummary) -> Result<GrowUnitCoordinationReceipt>
linkAgendaState(growUnitRef, agendaSummary) -> Result<GrowUnitCoordinationReceipt>
linkAttempt(growUnitRef, attemptRef) -> Result<GrowUnitCoordinationReceipt>
linkMessageList(growUnitRef, messageListRef) -> Result<GrowUnitCoordinationReceipt>
applyReadinessVerdict(growUnitRef, readinessVerdictRef) -> Result<GrowUnitTransitionReceipt>
linkHatchPackage(growUnitRef, hatchPackageRef) -> Result<GrowUnitTransitionReceipt>
```

事实：

```text
link 操作只关联 Ref 和 summary。
linkMessageList 不表示 Manager 编译 message list。
applyReadinessVerdict 只应用 Evidence & Readiness 的 verdict。
linkHatchPackage 不表示 Manager 构建 hatch package。
```

### Snapshot Port

```text
buildGrowUnitSnapshot(growUnitRef, options) -> Result<GrowUnitStateSnapshot>
explainGrowUnitState(growUnitRef) -> Result<GrowUnitStateExplanation>
listGrowUnits(query) -> Result<GrowUnitListPage>
```

事实：

```text
snapshot 是当前状态投影，不是真相来源。
snapshot 用于 CLI 展示、Context Compiler 输入和后续模块协调。
snapshot 不包含完整大内容。
explanation 说明当前状态来自哪些事件、Ref 和模块结果。
```

## 事件

该模块写入 grow_unit stream。

事件类型至少包括：

```text
grow_unit_created
grow_unit_goal_boundary_updated
grow_unit_target_world_linked
grow_unit_lifecycle_changed
grow_unit_blocked
grow_unit_unblocked
grow_unit_archived
grow_unit_admission_state_linked
grow_unit_agenda_state_linked
grow_unit_attempt_linked
grow_unit_message_list_linked
grow_unit_readiness_verdict_applied
grow_unit_hatch_package_linked
grow_unit_superseded
```

事实：

```text
事件 payload 保存 summary 和 Ref，不内联大型内容。
所有关键状态变化有事件证据。
纠错通过 superseding event，不改写旧事件。
```

## 与其他模块的边界

### Admission & Feedback Inbox

Admission 拥有输入和反馈准入。

Grow Unit Manager 只关联 Admission 的状态 summary。

事实：

```text
收到材料不等于 grow unit 直接变为 growing。
收到 feedback 不等于 grow unit 直接采纳。
```

### Agenda & DoD Manager

Agenda 拥有目标拆解、缺口和 DoD。

Grow Unit Manager 保存目标边界 summary 和 agendaRef。

事实：

```text
goalBoundarySummary 不替代 DoD。
Manager 不生成验证目标。
```

### Context & Message Compiler

Context Compiler 编译 message list artifact。

Grow Unit Manager 只保存 latestMessageListRef。

事实：

```text
Manager 不拼接 prompt。
Manager 不决定 skill 或 tool 本轮可见性。
```

### Grow Attempt Runner

Attempt Runner 执行一次 grow attempt。

Grow Unit Manager 关联 activeAttemptRef 和 attempt 结果 summary。

事实：

```text
attempt lifecycle 不属于 Grow Unit Manager。
attempt 失败不必然改变 grow unit lifecycle，必须看错误类型、Agenda 和 Readiness 结果。
```

### Evidence & Readiness

Evidence & Readiness 拥有 readiness verdict。

Grow Unit Manager 应用 verdict 推进 lifecycle。

事实：

```text
ready_to_hatch 必须来自 readiness verdict。
Manager 不基于模型自信进入 ready_to_hatch。
```

### Hatch Builder

Hatch Builder 构建 hatch package。

Grow Unit Manager 关联 hatch package ref 并进入 hatched 状态。

事实：

```text
hatch package 与 grow unit 不等价。
Manager 不复制 grow 目录。
```

### Skill Registry

Skill Registry 管理 skill scope 和 activation。

Grow Unit Manager 可以关联 skillScopeRef。

事实：

```text
skill scope 影响后续 Context Compiler 候选，但 Manager 不加载 skill body。
```

## Concurrency and Recovery

事实：

```text
同一 grow unit 同时只允许一个 mutating coordination step 生效。
并发 transition 通过 Event Ledger sequence、idempotency 或显式冲突处理。
中断的 attempt 不等于 grow unit 损坏。
恢复时从 Event Ledger projection、ArtifactRef 和关键 summary 重建 GrowUnitStateSnapshot。
恢复不依赖 provider 会话。
```

## 不变量

```text
GrowUnit 是连续成长空间。
不存在用户可见 Session。
同一个 GrowUnit 下不维护多个用户 session。
GrowUnitRecord 是 projection，不是真相来源。
状态变化必须写事件。
message list 是 Ref，不是 Manager 内部字符串。
ready_to_hatch 必须来自 Evidence & Readiness。
hatch package 与 grow unit 不等价。
feedback 必须先经过 Admission。
Manager 不调用 LLM。
Manager 不执行工具。
Manager 不构建 hatch package。
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
readiness_failed
append_conflict
projection_stale
transition_conflict
grow_unit_archived
grow_unit_blocked
```

事实：

```text
对 archived grow unit 的 mutating transition 返回 grow_unit_archived。
对 blocked grow unit 的 grow attempt 请求返回 grow_unit_blocked 或 waiting_input。
状态不兼容时返回 invalid_state 或 transition_conflict。
readiness verdict 不存在时不能进入 ready_to_hatch。
```

## 验证要求

实现阶段应验证：

```text
createGrowUnit 产生 grow_unit_created 事件。
GrowUnitRecord 可从 grow_unit stream 重建。
状态转换必须校验来源状态和目标状态。
没有 Session 类型从本模块导出。
openGrowUnit 不创建 session。
ready_to_hatch 只能由 readiness verdict 推动。
latestMessageListRef 只能引用 Context Compiler 产物。
Manager 无法 import LLM Gateway 或 Tool Runtime。
并发 transition 有冲突检测。
```

## 开放问题

```text
完整 lifecycle transition table 需要等 Admission、Agenda、Attempt、Readiness 和 Hatch spec 完成后联合收敛。
是否需要 workspace 级全局 sequence 需要与 Event Ledger 实现阶段共同判断。
blocked 与 waiting_input 的 CLI 展示差异需要等 CLI spec 确认。
grow unit archive 是否允许后续 unarchive 需要根据产品第一阶段取舍。
```

这些问题不影响本模块当前终态事实：Grow Unit Manager 是 grow 单元生命周期和协调记录的 owning module，不是会话管理器、执行器、prompt 编译器或 readiness 裁判。
