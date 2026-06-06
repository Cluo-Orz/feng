# Artifact Registry Spec

本文是 `Artifact Registry` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Artifact Registry` 管理 feng 中可定位的大内容和派生产物：材料、工具结果、message list、候选产物、验证报告、运行 trace、hatch package、摘要和预览。

它解决 file-native 与上下文污染之间的矛盾：完整内容可以在文件中存在，模型当前轮只看到由其他模块选择后的摘要、引用或片段。

## 职责

该模块负责：

```text
注册 artifact。
生成和解析 ArtifactRef。
保存 artifact metadata。
管理 artifact 内容位置。
生成和保存 artifact preview。
记录 artifact source、version、audit、privacy、retention。
提供受控 materialization。
表达 artifact lifecycle：active、archived、redacted、unavailable、retracted。
为 Event Ledger、Context Compiler、Tool Runtime、Evidence、Hatch、Runtime Trace 提供可引用内容。
```

该模块不负责：

```text
路径安全本身。
事件顺序和 replay。
业务状态转换。
message list 编译决策。
readiness 判断。
hatch 包内容选择。
工具执行。
LLM 调用。
反馈采纳。
具体目录 schema。
```

## 依赖关系

```text
Depends on:
  Domain Model & Contracts
  File-Native Store
  Event Ledger & Projection

Used by:
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

## Artifact Record

每个 artifact 都有一个 record。

Artifact record 至少表达：

```text
artifactId
artifactRef
kind
lifecycle
contentLocation
contentHash
size
mediaType
encoding
source
version
audit
privacyClass
retentionClass
previewRef
parentRefs
correlationId
```

事实：

```text
ArtifactRef 是跨模块引用，不是裸文件路径。
contentLocation 由 Artifact Registry 和 File-Native Store 解析。
contentHash 用于内容一致性，不表示业务版本。
parentRefs 用于表达派生产物来源。
```

## Artifact Kind

第一阶段必须支持的 kind 包括：

```text
source_material
user_input_attachment
compiled_message_list
runtime_message_list
tool_result
attempt_trace
runtime_trace
candidate_output
validation_report
feedback_evidence
hatch_package
runtime_contract
skill_body
memory_candidate
summary
preview
```

事实：

```text
kind 是语义分类，不绑定具体文件扩展名。
新的 kind 必须有版本和读取策略。
compiled_message_list 是 artifact，但只能由 Context & Message Compiler 创建。
runtime_message_list 是 artifact，但只能由 Agent Runtime Kernel 创建。
tool_result 是 artifact，但只能由 Tool Runtime 或 Grow Attempt Runner 创建。
hatch_package 是 artifact，但只能由 Hatch Builder 创建。
```

## Lifecycle

Artifact lifecycle 至少表达：

```text
registered
active
archived
redacted
unavailable
retracted
deleted
```

事实：

```text
registered 表示 artifact record 已存在，不表示业务采纳。
active 表示可正常读取。
archived 表示不进入常规活跃上下文候选，但可审计读取。
redacted 表示内容受隐私或发布规则限制。
unavailable 表示引用存在但内容暂不可读。
retracted 表示不应再用于未来 grow/hatch。
deleted 表示内容被删除，但 record 可保留审计状态。
```

## Privacy and Retention

Artifact record 带 privacy 与 retention 元数据。

Privacy class 至少表达：

```text
public
workspace_private
project_private
contains_secret
contains_user_content
contains_model_output
redacted
```

Retention class 至少表达：

```text
ephemeral
attempt_scoped
grow_scoped
hatch_scoped
runtime_scoped
archive
```

事实：

```text
privacy class 不等同于最终授权。
Policy & Capability Boundary 决定是否允许读取、上报、发布或打包。
Artifact Registry 必须把 privacy metadata 暴露给 Policy、Feedback Bridge 和 Hatch Builder。
```

## Ports

### Register Port

```text
registerArtifact(input) -> Result<ArtifactRef>
registerDerivedArtifact(input) -> Result<ArtifactRef>
registerExternalHandle(input) -> Result<ArtifactRef>
```

事实：

```text
registerArtifact 写入 artifact record 和必要 content。
registerDerivedArtifact 必须带 parentRefs。
registerExternalHandle 表达外部可定位内容，但默认不可信。
注册 artifact 不等于进入 grow 事实或 message list。
```

### Read and Materialize Port

```text
resolveArtifact(ref) -> Result<ArtifactRecord>
materializeArtifact(ref, options) -> Result<ArtifactMaterialization>
readArtifactPreview(ref, options) -> Result<ArtifactPreview>
readArtifactRange(ref, range, options) -> Result<ArtifactMaterialization>
```

materialization 至少表达：

```text
artifactRef
content or contentHandle
contentHash
range
truncated
redacted
privacyClass
source
version
readReceipt
```

事实：

```text
materialize 受 size、range、privacy 和 lifecycle guard 约束。
preview 可以用于显示和上下文候选，但不是完整事实。
redacted/unavailable artifact 返回显式状态，不静默空内容。
```

### Preview Port

```text
generatePreview(ref, policy) -> Result<ArtifactPreviewRef>
updatePreview(ref, previewInput) -> Result<ArtifactPreviewRef>
```

事实：

```text
preview 是派生产物。
preview 必须记录来源 artifact 和生成方式。
preview 不替代原始 artifact。
Context Compiler 可以选择 preview，但选择逻辑不属于 Artifact Registry。
```

### Lifecycle Port

```text
archiveArtifact(ref, reason) -> Result<ArtifactLifecycleReceipt>
redactArtifact(ref, reason) -> Result<ArtifactLifecycleReceipt>
markUnavailable(ref, reason) -> Result<ArtifactLifecycleReceipt>
retractArtifact(ref, reason) -> Result<ArtifactLifecycleReceipt>
deleteArtifactContent(ref, reason) -> Result<ArtifactLifecycleReceipt>
```

事实：

```text
lifecycle change 写入事件。
删除内容不删除审计 record。
retract 后的 artifact 不应被新 message list、readiness 或 hatch 使用。
```

## 与其他模块的边界

### File-Native Store

File Store 提供安全路径、原子读写和 content hash。

Artifact Registry 定义 artifact metadata、kind、privacy、lifecycle、preview 和 ref resolution。

### Event Ledger & Projection

Artifact Registry 对 artifact lifecycle 写事件。

Event Ledger 保存事件事实，不保存 artifact 内容。

### Context & Message Compiler

Context Compiler 决定哪些 artifact 的摘要、引用或片段进入 message list。

Artifact Registry 只提供 materialization、preview 和 metadata。

### Tool Runtime

Tool Runtime 执行工具并把大输出注册为 tool_result artifact。

Artifact Registry 不执行工具，也不判断工具成功与否。

### Evidence & Readiness

Evidence 模块把 validation_report、feedback_evidence、trace 等 ArtifactRef 作为证据。

Artifact Registry 不判断证据是否足够。

### Hatch Builder

Hatch Builder 选择哪些 artifact 进入能力包，并应用发布排除规则。

Artifact Registry 提供 artifact metadata、privacy、content 和 lifecycle。

## 不变量

```text
ArtifactRef 不等同于文件路径。
artifact registration 不等于业务采纳。
artifact preview 不等于 message list。
artifact lifecycle 不等于 grow/hatch lifecycle。
大内容通过 ArtifactRef 进入事件和跨模块 contract。
redacted/unavailable 状态必须显式返回。
删除内容不能抹掉审计 record。
Context Compiler 才能生成 compiled_message_list artifact。
Agent Runtime Kernel 才能生成 runtime_message_list artifact。
Hatch Builder 才能生成 hatch_package artifact。
```

## 错误行为

该模块使用 `Result<DomainError>` 表达业务失败。

错误 code 至少覆盖：

```text
not_found
invalid_input
invalid_state
artifact_unavailable
privacy_blocked
version_unsupported
schema_incompatible
file_too_large
unsupported_encoding
lifecycle_conflict
content_hash_mismatch
```

事实：

```text
读取 redacted artifact 返回 privacy_blocked 或 redacted materialization。
内容 hash 不匹配时显式失败。
未知 artifact kind 不静默当作 generic file。
retracted artifact 被用于新上下文或 hatch 时必须显式失败。
```

## 验证要求

实现阶段应验证：

```text
ArtifactRef 能解析到 artifact record。
大型内容不会被内联进 Event Ledger。
preview 与原始 artifact 有 parentRefs。
redacted artifact 不返回原始内容。
deleted content 仍保留审计 record。
content hash mismatch 被检测。
Context Compiler 之外无法创建 compiled_message_list kind。
Agent Runtime Kernel 之外无法创建 runtime_message_list kind。
Hatch Builder 之外无法创建 hatch_package kind。
```

## 开放问题

```text
artifact 内容布局和分片策略属于实现阶段或 File Store/Artifact 联合实现设计。
preview 的默认生成策略需要等 Context Compiler spec 确认上下文预算模型。
privacy class 的完整枚举需要与 Policy & Capability Boundary spec 联合细化。
```

这些问题不影响本模块当前终态事实：Artifact Registry 是 artifact 引用、metadata、preview、privacy 和 lifecycle 的管理层，不是上下文编译器、事件账本或 hatch 打包器。
