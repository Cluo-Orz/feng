# Agent Runtime Kernel Spec Round 01

## 当前草稿判断

第一版草稿容易把 hatch agent 写成：

```text
加载一段 system prompt。
把用户输入发给 LLM。
输出模型回答。
```

这只是 prompt wrapper，不是优秀 agent。

## 顶层视角检测

用户已经明确：hatch 出来的 agent 如果是 agent，就应该是优秀 agent。它至少要有：

```text
runtime contract。
目标世界输入。
runtime message list。
工具和目标动作边界。
短期上下文。
已采纳长期记忆读取。
runtime trace。
debug/feedback 能力。
生产版本锁定。
```

## 问题

```text
prompt wrapper 没有 file-native message list。
prompt wrapper 无法解释每轮模型看到了什么。
prompt wrapper 无法归一化目标世界动作。
prompt wrapper 无法把失败变成反馈候选。
prompt wrapper 不知道生产版本边界。
```

## 调整

补入：

```text
RuntimeInvocation
RuntimeMessageList
RuntimeTurn
RuntimeTrace
ShortTermContext
LongTermMemoryRead
RuntimeActionCycle
RuntimeOutput
RuntimeFeedbackCandidateHint
```

## 进入下一轮的结论

Agent Runtime Kernel 不能是 prompt wrapper。下一轮要检查它是否复制 Grow Kernel，变成 feng 的产品中心。

