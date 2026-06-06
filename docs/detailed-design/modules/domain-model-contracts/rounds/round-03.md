# Domain Model & Contracts Spec Round 03

## 当前草稿判断

第三轮准备定稿。当前设计已经把 Domain Model & Contracts 限定为领域语言和跨模块 contract，不再试图定义持久化 schema 或业务流程。

## 顶层视角检测

从顶层模块设计检查：

```text
Domain Model & Contracts 是最低依赖模块。
它应被所有模块依赖。
它不应依赖 File-Native Store、Event Ledger、Artifact Registry 或任何业务模块。
它不能决定 message list 如何编译、feedback 如何采纳、hatch 如何打包。
```

从产品概念检查：

```text
无 session 心智需要体现在命名中：使用 GrowUnit，而不是 Session。
file-native 需要体现在 Ref、ArtifactRef、MessageListRef，而不是内存对象传递。
反馈候选需要体现在 FeedbackStatus，而不是直接 accepted。
hatch 非固定 LLM loop 需要体现在 RuntimeKernelType。
```

从调研学习检查：

```text
opencode 提醒要有版本与不兼容拒绝。
CodeWhale 提醒要 typed state，但不要复制 thread/session。
AssistantAgent 提醒 experience/skill/package 要有来源和披露边界。
Hermes 提醒状态机、权限和生命周期要可审计。
```

## 问题

仍需避免两个过度：

```text
1. 不要在 spec 中写完整 TypeScript 实现代码，避免把设计锁成当前想象。
2. 不要只写抽象原则，后续模块需要明确可引用的类型族。
```

## 调整

最终 spec 采用“类型族 + 终态事实 + 不变量”的写法：

```text
列出必须存在的类型族。
说明每个类型族解决什么跨模块问题。
说明哪些类型不属于本模块。
说明版本、错误、来源、引用和状态不变量。
```

## 进入最终 spec 的结论

Domain Model & Contracts 模块可以定稿。它为后续 File-Native Store、Event Ledger、Artifact Registry、Grow Kernel 和 Hatch Runtime 提供统一语言，但不替代这些模块的详细 spec。
