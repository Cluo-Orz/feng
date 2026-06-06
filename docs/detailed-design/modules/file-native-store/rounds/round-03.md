# File-Native Store Spec Round 03

## 当前草稿判断

第三轮准备定稿。当前设计已经把 File-Native Store 限定为安全、原子、可审计的文件底座，不承担业务语义。

## 顶层视角检测

从产品概念检查：

```text
file-native 要求关键成长状态能在文件中找到。
但 file-native 不等于把一切垃圾都写进仓库。
需要筛选、脱敏、压缩和清理，File Store 只提供底层能力。
```

从 Domain Model & Contracts 检查：

```text
File Store 使用 DomainError/Result 表达失败。
File Store 可以使用 WorkspaceId、ArtifactId 等 id，但不生成业务 id。
File Store 的 receipt 可以被 Source/Audit/Artifact 使用。
```

从调研学习检查：

```text
opencode 的 read 工具强调路径 containment 和 symlink escape。
CodeWhale 的 checkpoint/artifact 说明读写要有可追踪位置。
learn-claude-code 的 tool_result spill 提醒大输出需要 handle，不应强塞上下文。
```

## 问题

仍需防止两种过度设计：

```text
1. 把 exact directory layout 写进 File Store spec。
2. 把 OS sandbox 或真实安全隔离包装成 File Store 能力。
```

## 调整

最终 spec 应明确：

```text
File Store 只定义 workspace 内文件操作事实，不定义 .feng 目录结构。
File Store 的 workspace containment 是结构安全，不等同于完整安全沙箱。
File Store 返回 read/write receipt，但业务事件由 Event Ledger 记录。
File Store 提供大文件分页和摘要能力，但上下文选择由 Context Compiler 决定。
```

## 进入最终 spec 的结论

File-Native Store 模块可以定稿。它为后续 Event Ledger、Artifact Registry、Context Compiler、Hatch Builder 提供可靠文件底座，但不替代这些模块的语义设计。
