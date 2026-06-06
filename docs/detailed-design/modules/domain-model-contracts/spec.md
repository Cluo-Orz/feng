# Domain Model & Contracts Spec

本文是 `Domain Model & Contracts` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Domain Model & Contracts` 是 feng TypeScript 项目的最低依赖模块。它定义全系统共享的领域语言、跨模块 contract、标识符、状态枚举、引用类型、结果类型、来源/版本元数据和业务错误表达。

所有其他 feng 模块依赖它。它不依赖任何 feng 业务模块。

## 职责

该模块负责：

```text
定义跨模块共享的 TypeScript 类型。
定义 branded id，避免不同实体 id 被裸 string 混用。
定义 Ref 类型，让模块通过引用传递 file-native artifact，而不是传递大型内存对象。
定义生命周期状态和状态值的兼容策略。
定义跨模块 Result 和 DomainError。
定义 SourceDescriptor、VersionDescriptor、AuditDescriptor 等来源与审计元数据。
定义所有模块都要理解的 contract 枚举，如 RuntimeKernelType、FeedbackStatus、ReadinessVerdict。
```

该模块不负责：

```text
文件读写。
事件追加。
artifact 保存。
业务流程编排。
message list 编译。
LLM 调用。
工具执行。
readiness 判断。
hatch 打包。
runtime 执行。
最终 JSON/YAML schema。
```

## 依赖关系

```text
Depends on:
  TypeScript standard language/runtime types only.

Used by:
  File-Native Store
  Event Ledger & Projection
  Artifact Registry
  Policy & Capability Boundary
  Skill Registry
  Grow Unit Manager
  Admission & Feedback Inbox
  Agenda & DoD Manager
  Context & Message Compiler
  LLM Gateway
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

## 类型族

### Identity Types

该模块定义 branded string id。不同实体 id 在 TypeScript 类型上不可互换。

必须存在的 id 类型包括：

```text
WorkspaceId
GrowUnitId
AttemptId
EventId
ArtifactId
MessageListId
FeedbackUnitId
HatchPackageId
RuntimeContractId
SkillId
ToolId
PolicyDecisionId
TargetWorldId
```

事实：

```text
所有跨模块 API 使用 branded id。
任何模块都不把裸 string 当作业务 id 传递。
id 的生成策略不在本模块定义，由拥有实体生命周期的模块决定。
```

### Reference Types

该模块定义跨模块引用类型。引用表达“有一个 file-native 事实或 artifact 可以被定位”，不表达具体文件路径。

必须存在的引用类型包括：

```text
ArtifactRef
MessageListRef
GrowUnitRef
AttemptRef
FeedbackUnitRef
HatchPackageRef
RuntimeContractRef
SkillRef
ToolResultRef
TraceRef
ValidationReportRef
```

事实：

```text
大型内容、工具结果、message list、trace、hatch package 通过 Ref 传递。
Ref 不等同于文件路径。
Ref 的解析由 Artifact Registry、File-Native Store 或对应 owning module 完成。
```

### Lifecycle State Types

该模块定义核心生命周期状态值。

Grow lifecycle 至少表达：

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

Attempt lifecycle 至少表达：

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

Feedback status 至少表达：

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

Hatch lifecycle 至少表达：

```text
requested
building
verifying_contract
packaged
published_local
failed
retracted
```

Runtime kernel type 至少表达：

```text
standard_agent_kernel
custom_agent_kernel
non_llm_runtime
hybrid_runtime
```

事实：

```text
状态类型是跨模块共享语言。
状态转换规则不在本模块实现。
不兼容或未知状态必须被显式表示为 unsupported/unknown 结果，而不是静默降级。
```

### Result and Error Types

所有跨模块业务操作返回统一 Result 形态。

结果族包括：

```text
Ok<T>
Err<DomainError>
```

DomainError 至少表达：

```text
code
message
module
severity
retryable
source
evidenceRef
cause
```

错误 code 必须能区分：

```text
not_found
invalid_state
invalid_input
permission_denied
policy_blocked
version_unsupported
schema_incompatible
artifact_unavailable
context_budget_exceeded
llm_failed
tool_failed
readiness_failed
privacy_blocked
```

事实：

```text
业务失败通过 Result 表达。
异常只用于真正不可恢复的程序错误或 host runtime failure。
跨模块调用不得要求调用方解析自然语言错误。
```

### Source, Version, and Audit Types

外部输入、持久事实、artifact、feedback、hatch package 和 policy decision 都携带来源与版本信息。

来源类型至少表达：

```text
kind
origin
workspace
growUnit
runtime
userProvided
generatedBy
receivedAt
privacyLevel
```

版本类型至少表达：

```text
schemaVersion
contractVersion
producerVersion
compatibleRange
```

审计类型至少表达：

```text
createdAt
createdBy
reason
correlationId
parentRef
evidenceRefs
```

事实：

```text
任何会进入 file-native 事实层的数据都有来源。
任何可能跨版本读取的数据都有版本。
任何关键决策都有审计字段和证据引用。
```

### Contract Types

该模块定义跨模块 contract 的公共类型族，但不定义具体模块内部 schema。

必须存在的 contract 类型族包括：

```text
RuntimeContractSummary
TargetWorldContractSummary
PolicyDecision
ReadinessVerdict
CompiledMessageListSummary
ToolCallSummary
ToolResultSummary
HatchPackageSummary
FeedbackRoutingDecision
SkillDescriptor
```

事实：

```text
Summary 类型用于跨模块判断和展示。
完整内容通过 Ref 读取。
模块私有细节不进入全局 contract。
```

## 不变量

```text
本模块不出现 Session 命名作为用户心智概念。
GrowUnit 是连续成长空间的唯一顶层成长边界。
MessageList 是编译产物，必须可引用。
Feedback 默认是 candidate 状态。
HatchPackage 与 GrowUnit 不等价。
RuntimeKernelType 不默认等于 LLM agent。
所有跨模块 id 都是 branded id。
所有大型内容通过 Ref 传递。
所有跨模块业务失败通过 Result/DomainError 表达。
```

## 与 File-Native 的关系

该模块不读写文件，但它让 file-native 成为可类型化的系统事实：

```text
ArtifactRef 表示可定位 artifact。
MessageListRef 表示下一轮模型输入的文件化产物。
TraceRef 表示运行可观察证据。
ValidationReportRef 表示 readiness 的证据来源。
SourceDescriptor 和 AuditDescriptor 让文件事实可追踪。
```

## 与后续模块的边界

```text
File-Native Store 负责路径、读写和原子性。
Event Ledger & Projection 负责事件事实和投影。
Artifact Registry 负责 Ref 解析和 artifact 生命周期。
Context & Message Compiler 负责生成 MessageListRef。
Evidence & Readiness 负责生成 ReadinessVerdict。
Hatch Builder 负责生成 HatchPackageRef。
Runtime Contract Registry 负责 RuntimeContract 的完整定义和验证。
```

本模块只提供这些模块共享的语言。

## 验证要求

该模块完成后应能被以下方式验证：

```text
TypeScript 编译能阻止不同 branded id 混用。
跨模块 API 只能使用本模块导出的共享类型。
没有 feng 业务模块被本模块 import。
不存在 session 作为用户心智顶层类型。
message list、artifact、trace、hatch package 通过 Ref 表达。
Result/DomainError 能覆盖核心失败类型。
```

这些验证可以在实现阶段通过 TypeScript type tests、lint rules 和 import-boundary tests 完成。

## 开放问题

```text
branded id 的具体实现方式使用 type brand、opaque type helper 还是 symbol brand，需要实现阶段确定。
DomainError code 是否需要分层 namespace，需要等 File-Native Store 和 Event Ledger spec 完成后再细化。
RuntimeContractSummary 的最小字段需要在 Runtime Contract Registry spec 中最终确定。
```

这些问题不影响本模块当前终态事实：它是 feng 全系统共享领域语言，不是持久化 schema 或业务流程实现。
