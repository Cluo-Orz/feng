# Grow Attempt Runner Spec Round 03

## 当前草稿判断

第三版草稿需要继续检查长程任务中最容易出问题的三个点：

```text
依赖 provider session 作为恢复依据。
把 tool result 直接作为下一轮 provider message。
把 attempt 内部 turn 当成用户可见 session。
```

这些都会破坏 feng 的 file-native 和无 session 不变量。

## 顶层视角检测

feng 的下一轮 LLM loop 使用的 message list 也是文件化产物。这个约束在 attempt 内部也成立。

因此，当模型提出工具调用后：

```text
Tool Runtime 执行并产生 ToolSettlement。
Runner 记录 settlement 和 checkpoint。
Runner 请求 Context Compiler 基于新事实编译 continuation message list。
LLM Gateway 使用新的 MessageListRef 发起下一轮 provider call。
```

Runner 不允许在内存里把工具输出直接拼成 provider-specific tool message 后继续调用模型。

## 问题

```text
provider session 不可作为 feng 的业务事实。
stream delta 只在内存中存在会导致中断后无法解释。
tool result 原文可能很大或敏感，直接进上下文会污染 message list。
attempt turn 容易被误认为用户 session。
```

## 调整

固定以下终态规则：

```text
attempt 不是 session。
turn 是 attempt trace 内部记录，不是用户心智概念。
每个 turn 使用一个 MessageListRef。
continuation message list 只能由 Context Compiler 生成。
tool result 通过 ToolSettlement 和 tool_result artifact 进入事实层。
恢复从 attempt checkpoint、MessageListRef、ProviderCallReceipt 和 ToolSettlement 开始。
```

## 进入下一轮的结论

Grow Attempt Runner spec 可以收敛为最终版本。它提供长程任务的执行骨架，但不拥有目标、上下文选择、工具权限、证据判断或生命周期判断。

