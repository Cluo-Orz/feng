# File-Native Store Spec

本文是 `File-Native Store` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`File-Native Store` 是 feng 的安全文件底座。它提供工作区定位、路径规范化、结构性 containment、文本/二进制读写、原子写入、读写收据、内容摘要和受限目录遍历。

它让 feng 的关键状态可以成为 file-native 事实，但它不理解这些事实的业务语义。

## 职责

该模块负责：

```text
定位当前 workspace。
把逻辑路径解析为 workspace 内受控路径。
拒绝 path traversal、绝对路径逃逸和 symlink escape。
提供文本和二进制读取。
提供大文件分页或范围读取。
提供目录列表和基础文件 metadata。
提供原子写入。
提供受控 append primitive，供 Event Ledger 等模块构建 append-only 事实。
计算内容摘要。
返回 read/write/append receipt。
清理失败写入产生的临时文件。
```

该模块不负责：

```text
业务授权。
OS sandbox。
事件语义。
artifact 语义和生命周期。
grow 状态。
message list 编译。
feedback 采纳。
hatch 打包。
具体 .feng 目录结构。
```

## 依赖关系

```text
Depends on:
  Domain Model & Contracts
  Node.js filesystem/path/crypto runtime or equivalent platform adapter

Used by:
  Event Ledger & Projection
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

`File-Native Store` 不直接依赖 `Policy & Capability Boundary`，避免 foundation 层依赖环。需要业务授权的调用方先取得 policy decision，再调用本模块。本模块始终执行不可绕过的结构安全检查。

## 公共类型族

该模块导出与文件操作相关的 TypeScript 类型族。

### Workspace Types

```text
WorkspaceHandle
WorkspaceRoot
WorkspaceRelativePath
ResolvedWorkspacePath
```

事实：

```text
业务模块使用 workspace-relative logical path。
绝对路径只在 File-Native Store 内部或受控 receipt 中出现。
workspace root 在创建 handle 时被 canonicalize。
```

### File Metadata Types

```text
FileKind
FileStat
DirectoryEntry
ContentHash
Encoding
ByteRange
LineRange
```

事实：

```text
FileStat 包含 kind、size、mtime、content hash 可用性等 metadata。
ContentHash 用于证明内容版本，不表达业务版本。
DirectoryEntry 不递归携带无限子树。
```

### Receipt Types

```text
ReadReceipt
WriteReceipt
AppendReceipt
DeleteReceipt
DirectoryListReceipt
```

receipt 至少表达：

```text
workspace
logicalPath
operation
contentHash before/after where applicable
bytes read/written
timestamp
caller-provided reason/correlation id
```

事实：

```text
receipt 可以被 Event Ledger、Artifact Registry 或 AuditDescriptor 引用。
receipt 不等同于业务事件。
```

## Ports

### Workspace Port

该模块提供 workspace 定位能力：

```text
openWorkspace(input) -> Result<WorkspaceHandle>
describeWorkspace(handle) -> Result<WorkspaceDescriptor>
```

事实：

```text
workspace handle 是后续文件操作的入口。
workspace handle 不暴露为用户需要理解的 session。
```

### Path Resolution Port

该模块提供受控路径解析：

```text
resolvePath(workspace, logicalPath, options) -> Result<ResolvedWorkspacePath>
```

路径解析事实：

```text
拒绝空路径、非法路径段、path traversal 和 workspace 外路径。
默认拒绝绝对路径。
默认拒绝 symlink escape。
Windows 和 POSIX 分隔符被归一化为同一种 logical path 表示。
解析结果保留 logical path 和内部 canonical path 的对应关系。
```

### Read Port

该模块提供文本、二进制和范围读取：

```text
readText(workspace, logicalPath, options) -> Result<TextRead>
readBinary(workspace, logicalPath, options) -> Result<BinaryRead>
readTextRange(workspace, logicalPath, range, options) -> Result<TextRead>
stat(workspace, logicalPath) -> Result<FileStat>
listDirectory(workspace, logicalPath, options) -> Result<DirectoryListing>
```

读取事实：

```text
默认文本编码是 UTF-8。
大文件读取必须支持 size guard 或 range guard。
目录遍历默认非递归。
递归遍历必须有 depth 和 entry count 限制。
读取结果包含 ReadReceipt 或可生成 ReadReceipt 的 metadata。
```

### Write Port

该模块提供原子写入：

```text
writeTextAtomic(workspace, logicalPath, content, options) -> Result<WriteReceipt>
writeBinaryAtomic(workspace, logicalPath, content, options) -> Result<WriteReceipt>
appendRecordAtomic(workspace, logicalPath, record, options) -> Result<AppendReceipt>
ensureDirectory(workspace, logicalPath, options) -> Result<DirectoryReceipt>
```

写入事实：

```text
写入先写临时文件，再以原子替换方式提交。
写入失败不会留下被误认为有效事实的目标文件。
父目录创建必须显式请求。
append primitive 保证单条 record 边界，不解释 record 的业务含义。
写入结果包含 content hash 和 WriteReceipt。
```

### Maintenance Port

该模块提供基础维护能力：

```text
removeFile(workspace, logicalPath, options) -> Result<DeleteReceipt>
moveWithinWorkspace(workspace, from, to, options) -> Result<MoveReceipt>
cleanupTemps(workspace, options) -> Result<CleanupReport>
```

维护事实：

```text
删除和移动仍受 workspace containment 限制。
危险操作是否允许由调用方的 policy 决策负责。
cleanup 只处理本模块可识别的临时文件。
```

## 不变量

```text
所有文件操作都绑定 WorkspaceHandle。
所有业务模块传入 logical path，不传入裸绝对路径。
所有路径解析都 canonicalize 并检查 containment。
任何 workspace 外路径默认失败。
symlink escape 默认失败。
写入默认原子提交。
大文件读取必须有 guard。
目录遍历默认有边界。
读写返回 Result，不抛业务错误。
receipt 不替代 Event Ledger 事件。
File Store 不解释 grow、feedback、hatch、message list 语义。
```

## 错误行为

该模块使用 Domain Model & Contracts 的 `Result<DomainError>` 表达业务失败。

错误 code 至少覆盖：

```text
not_found
invalid_input
permission_denied
policy_blocked
artifact_unavailable
schema_incompatible
path_escape_rejected
symlink_escape_rejected
file_too_large
unsupported_encoding
atomic_write_failed
io_failed
```

事实：

```text
路径越界是显式失败，不做路径修正后继续。
编码失败是显式失败，不静默替换内容。
部分写入失败必须返回失败和清理状态。
```

## 与其他模块的边界

### Event Ledger & Projection

Event Ledger 使用 File Store 的 append primitive 和 receipt 构建事件事实。

File Store 不理解 event type、event ordering 或 projection。

### Artifact Registry

Artifact Registry 使用 File Store 存放和读取 artifact 内容。

File Store 不理解 artifact type、retention、privacy、preview 或 handle 语义。

### Policy & Capability Boundary

Policy 决定业务动作是否允许。

File Store 执行结构安全检查。即使 policy 允许，路径逃逸仍失败。

### Context & Message Compiler

Context Compiler 可以通过 File Store 读取材料、message list、摘要和 artifact 内容。

File Store 不决定哪些内容进入模型上下文。

### Hatch Builder

Hatch Builder 使用 File Store 读取资源和写入能力包。

File Store 不决定哪些文件应该发布、排除或脱敏。

## File-Native 事实

该模块保证 feng 能把关键状态落到文件上，但最终事实归属由上层模块决定：

```text
Grow 事实由 Grow Unit Manager / Event Ledger 管理。
Message list artifact 由 Context & Message Compiler / Artifact Registry 管理。
Tool result artifact 由 Tool Runtime / Artifact Registry 管理。
Hatch package artifact 由 Hatch Builder / Artifact Registry 管理。
Runtime trace artifact 由 Agent Runtime Kernel / Artifact Registry 管理。
```

## 验证要求

实现阶段应验证：

```text
Windows 和 POSIX 路径分隔符都被正确规范化。
`..` path traversal 被拒绝。
绝对路径默认被拒绝。
symlink 指向 workspace 外时被拒绝。
原子写失败不会破坏旧文件。
大文件读取触发 guard。
目录遍历受 depth 和 entry count 限制。
读写 receipt 包含内容 hash 和 logical path。
业务模块无法直接依赖内部 absolute path 类型。
```

## 开放问题

```text
原子写是否要求 fsync 目录，在 Windows 与 POSIX 上实现细节不同，需要实现阶段评估。
是否提供跨进程文件锁，需要等 Event Ledger spec 确定并发模型。
logical path 是否使用 POSIX 风格字符串作为唯一表示，需要实现阶段定稿。
```

这些问题不改变本模块终态事实：File-Native Store 是安全、原子、可审计的文件底座，不是业务状态管理器。
