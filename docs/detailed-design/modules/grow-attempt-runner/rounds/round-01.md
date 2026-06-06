# Grow Attempt Runner Spec Round 01

## 当前草稿判断

第一版草稿容易把 `Grow Attempt Runner` 写成一个普通 LLM loop：

```text
拿到 prompt。
调用模型。
如果模型要工具就执行工具。
把结果发回模型。
直到模型输出完成。
```

这个草稿不够。它看起来能跑，但无法支撑 feng 的长程任务、file-native 和可恢复要求。

## 顶层视角检测

feng 的 grow 不是一次聊天，也不是 provider session。一次 attempt 是连续成长空间中的一个执行片段，必须回答：

```text
本次 attempt 为什么存在。
使用了哪个 AttemptIntent。
使用了哪些输入快照。
每一轮 message list 是怎么编译出来的。
调用了哪个 provider/model。
模型输出了什么。
哪些 tool-call 被提出。
工具如何校验、授权、执行和结算。
哪些产物成为 candidate output。
进程中断后从哪里恢复。
```

如果这些只存在内存里，feng 就无法解释自己如何 grow，也无法保证长程任务不会在上下文和状态之间漂移。

## 问题

```text
缺少 AttemptRecord，无法表达一次执行片段的业务事实。
缺少 AttemptTrace，无法审计 LLM turn、tool settlement 和产物。
缺少 checkpoint，进程中断后只能依赖 provider session 或日志猜测。
缺少 messageListRef 序列，工具结果可能被直接拼进下一轮 prompt。
缺少 exitReason，Agenda 和 Evidence 无法区分完成、失败、等待输入和重试耗尽。
```

## 调整

将模块定位调整为：

```text
一次 grow attempt 的可恢复执行编排层。
```

补入以下终态对象：

```text
AttemptRecord
AttemptExecutionPlan
AttemptInputSnapshot
AttemptTurnRecord
AttemptCheckpoint
AttemptTraceArtifact
AttemptOutcomeSummary
AttemptExitReason
```

并固定：

```text
每个 LLM turn 都引用 MessageListRef。
每个工具调用都通过 Tool Runtime 返回 ToolSettlement。
每个候选输出都通过 Artifact Registry 注册。
每个关键边界都有 checkpoint。
```

## 进入下一轮的结论

Attempt Runner 不能只是 LLM loop。下一轮要检测它是否反过来过度膨胀，变成决定目标、策略和 readiness 的隐藏大脑。

