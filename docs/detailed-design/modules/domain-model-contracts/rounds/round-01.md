# Domain Model & Contracts Spec Round 01

## 当前草稿判断

初稿想把 Domain Model & Contracts 写成所有核心对象的字段集合：

```text
GrowUnit。
Attempt。
MessageList。
Artifact。
FeedbackUnit。
HatchPackage。
RuntimeContract。
Skill。
PolicyDecision。
```

这个方向必要，但如果直接写字段，会过早滑向 JSON/YAML schema。

## 顶层视角检测

从顶层模块设计看，Domain Model & Contracts 是所有模块依赖的最低层。它应该定义 TypeScript 领域语言，而不是定义文件格式。

从调研结果看，opencode 的 schema changelog 和 CodeWhale 的 typed state 都说明：类型、事件和持久化 schema 相关，但不是同一个层级。feng 还没有进入最终文件 schema 设计，不能让第一个模块把所有文件格式锁死。

## 问题

```text
1. 如果字段过细，会绕过 File-Native Store 和 Event Ledger 的后续设计。
2. 如果把 MessageList 当普通对象，会弱化“message list 是 artifact”的不变量。
3. 如果把 FeedbackUnit 写成可直接 accepted 的事实，会破坏反馈候选准入。
4. 如果不定义统一 Result/Error，后续模块会各自发明错误表达。
```

## 调整

本模块应定义：

```text
领域标识符。
生命周期枚举。
引用类型。
跨模块 command/result/event payload 的概念边界。
通用错误、来源、版本、审计字段。
```

不定义：

```text
最终 JSON/YAML schema。
目录结构。
文件名。
provider request shape。
MCP tool schema。
具体 runtime adapter 字段。
```

## 进入下一轮的结论

Round 02 需要补充 branded id、状态枚举、Result/Error、Source/Version、Ref 类型，并明确它们如何支持后续模块而不绑死持久化格式。
