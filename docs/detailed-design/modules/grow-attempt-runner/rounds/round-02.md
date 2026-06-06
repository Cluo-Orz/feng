# Grow Attempt Runner Spec Round 02

## 当前草稿判断

第二版草稿补齐了执行事实，但出现了新的风险：Attempt Runner 可能变成 Grow Kernel 的隐藏大脑。

风险形态包括：

```text
自己决定下一轮该做什么。
自己修订 Agenda 或 DoD。
自己判断工具结果是否满足 DoD。
自己把模型输出改成 grow lifecycle。
自己决定 ready_to_hatch。
```

这会让 feng 重新变成不可解释的 agent loop。

## 顶层视角检测

已有模块已经划分了职责：

```text
Agenda & DoD Manager 生成 AttemptIntent。
Context & Message Compiler 生成 message list。
LLM Gateway 调 provider 并归一化模型输出。
Tool Runtime 执行工具并返回 settlement。
Evidence & Readiness 判断证据和 readiness。
Grow Unit Manager 应用 lifecycle。
```

Attempt Runner 的价值是把这些模块按一次 attempt 串起来，并把过程文件化。它不拥有这些模块的判断规则。

## 问题

```text
如果 Runner 自己选择目标，会绕过 Agenda。
如果 Runner 自己拼 prompt，会绕过 Context Compiler。
如果 Runner 自己执行 tool-call，会绕过 Tool Runtime。
如果 Runner 自己判断完成，会绕过 Evidence & Readiness。
如果 Runner 自己改 grow lifecycle，会绕过 Grow Unit Manager。
```

## 调整

收紧边界：

```text
Runner 只消费 AttemptIntent，不生成 grow 目标。
Runner 只请求 Context Compiler 编译 message list，不手写 prompt。
Runner 只调用 LLM Gateway，不解析 provider 原始协议。
Runner 只把 tool-call 转换为 ToolCallRequest，不执行工具。
Runner 只产出 AttemptOutcomeSummary，不产出 readiness verdict。
Runner 只写 attempt stream 和 attempt_trace artifact，不直接改 grow lifecycle。
```

同时明确：

```text
attempt completed 只表示本次执行片段结束。
candidate output 只表示候选产物。
tool succeeded 只表示工具执行成功。
这些都不等于 hatch ready。
```

## 进入下一轮的结论

Attempt Runner 的边界从“大脑”收回到“可恢复执行编排层”。下一轮要检测它是否会依赖 provider session、把工具输出直塞上下文，或破坏 feng 的无 session 心智。

