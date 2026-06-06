# Tool Runtime Spec Round 03

## 当前草稿判断

第三版草稿的模块边界基本成立，但还要检查三个高风险误区：

```text
工具结果直接改 grow state。
工具输出直接进入下一轮 message list。
工具成功被误认为 readiness 证据充分。
```

这三个误区都会让 feng 的长程任务失去可解释性。

## 顶层视角检测

从 feng 的核心不变量看：

```text
关键状态必须 file-native。
message list 是编译产物，不是真相来源。
工具执行必须经过 policy。
readiness 必须基于证据。
runtime feedback 不能绕过 inbox 直接污染上游。
```

Tool Runtime 执行完工具后，只能产生事实：执行过什么、输入是什么、输出在哪里、是否成功、有什么副作用摘要、错误如何分类。它不能替其他模块判断“这是否完成了 grow 目标”。

## 问题

```text
工具结果可能很大，直接放进 LLM 输入会污染上下文。
工具副作用可能发生在文件、网络、目标世界或外部服务，不能只看返回值。
工具成功只说明工具调用成功，不说明 DoD 满足。
工具失败需要被 Attempt Runner 和 Agenda 解释，而不是由 Tool Runtime 自行转成下一步计划。
```

## 调整

固定以下终态规则：

```text
ToolExecutionReceipt 是执行事实，不是 grow state。
ToolSettlement 是调用结算，不是 readiness verdict。
ToolResultArtifact 是结果引用，不是 message list。
副作用必须以 sideEffectSummary 和 policyDecisionId 可审计表达。
高风险工具调用没有 PolicyDecision 时不能执行。
工具输出进入下一轮上下文只能通过 Admission/Artifact/Context Compiler 的正常路径。
```

## 进入下一轮的结论

Tool Runtime spec 可以收敛为最终版本。它是工具注册、工具面摘要、输入校验、policy 执行、结果归档和调用结算层；它不是 prompt 编译器、grow state owner、readiness 裁判或插件生态中心。

