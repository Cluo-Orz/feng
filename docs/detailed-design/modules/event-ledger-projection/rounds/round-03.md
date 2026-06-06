# Event Ledger & Projection Spec Round 03

## 当前草稿判断

第三轮准备定稿。当前设计将 Event Ledger 定义为事件事实源，将 Projection 定义为可重建视图。

## 顶层视角检测

从顶层模块设计检查：

```text
Event Ledger & Projection 是 Foundation 模块。
它依赖 Domain Model & Contracts 和 File-Native Store。
它被 Grow Unit Manager、Attempt Runner、Evidence、Hatch、Feedback 等模块使用。
它不决定 grow lifecycle 是否进入 ready_to_hatch。
它不决定 feedback 是否 accepted。
它不编译 message list。
```

从产品概念检查：

```text
file-native 要求关键状态能追踪。
长程 grow 要求中断后能恢复判断。
反馈候选要求状态变化可审计。
hatch 要求版本和来源可追踪。
```

这些都需要 Ledger，但不意味着 Ledger 自己拥有业务判断。

## 问题

仍需防止：

```text
1. 把 projection 当 source of truth。
2. 把业务状态转换规则写进 Ledger。
3. 把大型内容写进 event body。
4. 提前定义所有事件 payload schema。
```

## 调整

最终 spec 应明确：

```text
Ledger 只保证事件 envelope、顺序、append、读取、重放和 projection 机制。
具体事件类型由 owning module 在各自 spec 中定义。
Projection 可被缓存，但必须能从事件重建。
projection 不兼容时应重建或显式失败。
事件 payload 可内联小摘要，但完整大内容通过 ArtifactRef。
```

## 进入最终 spec 的结论

Event Ledger & Projection 模块可以定稿。它是 feng 长程任务、file-native 状态和可审计演进的事实基础，但不是业务状态机本身。
