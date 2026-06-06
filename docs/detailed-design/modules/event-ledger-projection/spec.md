# Event Ledger & Projection Spec

本文是 `Event Ledger & Projection` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Event Ledger & Projection` 是 feng 的 append-only 事件事实源和状态投影机制。它记录关键状态变化，支持 replay、恢复、审计、projection rebuild 和版本不兼容检测。

它保证“发生过什么”可追踪，但不替代业务模块判断“应该发生什么”。

## 职责

该模块负责：

```text
定义 event envelope。
按 stream 追加 append-only 事件。
维护 stream 内递增 sequence。
处理 idempotency。
读取和重放事件。
构建和刷新 projection。
保存 projection checkpoint。
检测 event/projection 版本不兼容。
返回 event append/read/projection receipt。
```

该模块不负责：

```text
文件路径安全。
artifact 内容保存。
grow lifecycle 决策。
feedback 采纳决策。
readiness 判断。
message list 编译。
hatch 打包。
LLM 调用。
工具执行。
具体事件 payload 的全部业务 schema。
```

## 依赖关系

```text
Depends on:
  Domain Model & Contracts
  File-Native Store

Used by:
  Artifact Registry
  Policy & Capability Boundary
  Skill Registry
  Grow Unit Manager
  Admission & Feedback Inbox
  Agenda & DoD Manager
  Context & Message Compiler
  Tool Runtime
  Grow Attempt Runner
  Evidence & Readiness
  Hatch Builder
  Runtime Contract Registry
  Agent Runtime Kernel
  Target World Adapter
  Debug & Feedback Bridge
  CLI
```

## 核心事实

### Event Envelope

每个事件都有标准 envelope。

Event envelope 至少表达：

```text
eventId
streamId
streamType
sequence
eventType
eventVersion
payload
payloadRef
source
audit
correlationId
causationId
createdAt
producer
```

事实：

```text
eventId 是 branded id。
stream 内 sequence 严格递增。
eventType 是业务模块定义的类型标识。
eventVersion 标记事件 payload 版本。
payload 可以携带小型结构化摘要。
大型内容必须通过 payloadRef 或 ArtifactRef 引用。
```

### Streams

Ledger 以 stream 组织事件。

第一阶段必须支持的 stream 类型包括：

```text
workspace
grow_unit
attempt
feedback_unit
hatch_package
runtime_trace
skill
policy
```

事实：

```text
stream 是事件顺序边界。
同一 stream 内有严格顺序。
跨 stream 通过 correlationId、causationId 和 timestamp 关联。
第一阶段不承诺全局事务序列。
```

### Append

事件追加是不可变操作。

该模块提供：

```text
appendEvent(stream, event) -> Result<EventAppendReceipt>
appendBatch(stream, events) -> Result<EventAppendReceipt>
readStream(stream, options) -> Result<EventPage>
replayStream(stream, options) -> Result<EventReplay>
```

事实：

```text
append 成功后事件不可修改。
纠错通过追加 superseding event，而不是改写旧事件。
重复 append 使用 idempotency key 或 eventId 判断。
同一 idempotency key 的相同 payload 返回已有 receipt。
同一 idempotency key 的不同 payload 返回冲突错误。
```

### Projection

Projection 是从事件构建的当前视图。

该模块提供：

```text
buildProjection(name, streamSelector) -> Result<ProjectionSnapshot>
readProjection(name, key) -> Result<ProjectionSnapshot>
rebuildProjection(name, options) -> Result<ProjectionRebuildReport>
invalidateProjection(name, reason) -> Result<ProjectionInvalidationReceipt>
```

必须支持的 projection 类别包括：

```text
grow unit current state
attempt timeline
feedback status
hatch lifecycle
runtime trace index
skill state
policy decision audit view
```

事实：

```text
Projection 是缓存/视图，不是真相来源。
Projection 必须能从事件重建。
Projection checkpoint 记录构建到哪个 stream sequence。
Projection 版本不兼容时必须重建或显式失败。
业务模块不能只写 projection 而不写事件。
```

## 与 File-Native Store 的关系

Event Ledger 使用 File-Native Store 的 append primitive、atomic write 和 receipt。

事实：

```text
File Store 保证文件结构安全和写入原子性。
Ledger 保证事件 envelope、sequence、idempotency 和 replay 语义。
File Store receipt 可以被 Ledger append receipt 引用。
File Store 不理解 eventType 或 projection。
```

## 与 Artifact Registry 的关系

事件可以引用 artifact，但不拥有 artifact 生命周期。

事实：

```text
大型工具结果、message list、trace、validation report、hatch package 通过 ArtifactRef 引用。
Event payload 只保留足够用于索引、审计和投影的小型摘要。
Artifact 删除、归档、脱敏不由 Ledger 决定。
```

## 与业务模块的关系

业务模块拥有事件语义：

```text
Grow Unit Manager 定义 grow lifecycle 事件。
Admission & Feedback Inbox 定义 input/feedback admission 事件。
Grow Attempt Runner 定义 attempt lifecycle 事件。
Evidence & Readiness 定义 evidence 和 readiness verdict 事件。
Hatch Builder 定义 hatch package lifecycle 事件。
Agent Runtime Kernel 定义 runtime trace 事件。
```

Event Ledger 只提供 envelope、append、read、replay 和 projection 机制。

## 不变量

```text
事件 append-only。
事件不可原地修改。
projection 可重建，不是真相来源。
stream 内 sequence 严格递增。
重复写入必须 idempotent 或显式冲突。
大 payload 使用 ArtifactRef。
事件版本不兼容不得静默读取。
业务状态变化必须有事件证据。
```

## 错误行为

该模块使用 `Result<DomainError>` 表达业务失败。

错误 code 至少覆盖：

```text
not_found
invalid_input
invalid_state
version_unsupported
schema_incompatible
io_failed
append_conflict
sequence_conflict
idempotency_conflict
projection_stale
projection_incompatible
artifact_unavailable
```

事实：

```text
事件版本过新时显式失败。
projection checkpoint 指向不存在事件时显式失败。
idempotency key 冲突时显式失败。
artifact 引用不可用时，事件仍可读取，但需要返回 artifact_unavailable 证据状态。
```

## 版本策略

```text
每个 event envelope 有 eventVersion。
每个 projection 有 projectionVersion。
读取未知 eventVersion 时，不做静默降级。
Projection rebuild 使用明确 projectionVersion。
旧 projection 与当前 reducer 不兼容时，必须 rebuild 或失败。
```

## 验证要求

实现阶段应验证：

```text
同一 stream sequence 单调递增。
重复 append 相同 idempotency key 和相同 payload 返回同一结果。
重复 append 相同 idempotency key 和不同 payload 返回冲突。
projection 删除后可从事件重建。
projection 版本不兼容时不会被当成有效当前状态。
事件 payload 引用大型 artifact，而不是内联大内容。
业务模块无法直接写 projection 绕过事件。
```

## 开放问题

```text
第一阶段是否需要 workspace 级全局 sequence，仍需在 Grow Unit Manager spec 后判断。
事件存储采用 JSONL、分段日志还是其他格式，属于实现阶段或 File Store/Event Ledger 联合实现设计。
projection reducer 注册方式需要等后续业务模块 spec 明确事件类型后细化。
```

这些问题不影响本模块当前终态事实：Ledger 是 append-only 事件事实源，Projection 是可重建视图。
