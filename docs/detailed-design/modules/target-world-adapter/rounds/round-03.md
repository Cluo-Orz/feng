# Target World Adapter Spec Round 03

## 当前草稿判断

第三版草稿要处理运行反馈和验证的污染风险：

```text
debug signal 直接写入上游 grow。
validation report 直接变成 readiness passed。
target action 未经 policy 执行。
目标世界私有状态默认进入 package 或上游。
```

## 顶层视角检测

目标世界是证据和反馈的重要来源，但不是自动真相。它产生的信号必须走对应模块：

```text
validation report 进入 Artifact/Evidence。
debug signal 进入 Debug & Feedback Bridge。
feedback candidate 进入 Admission & Feedback Inbox。
target action 先经过 Runtime Contract 和 Policy。
```

## 问题

```text
目标世界状态可能包含用户内容或私有项目数据。
验证失败可能是 adapter 问题、runtime 问题或目标世界问题，需要归因。
动作输出可能有真实外部效果。
```

## 调整

固定以下规则：

```text
Debug signal 不等于 feedback accepted。
Validation report 不等于 readiness verdict。
Target action request 不等于 action executed。
目标世界私有内容默认不向上游传播。
所有 runtime.target_action 都需要 PolicyDecision 或外部 enforcement 声明。
```

## 进入下一轮的结论

Target World Adapter spec 可以收敛。它负责目标世界输入、动作/事件、验证、失败和调试信号的归一化，不绕过 contract、policy、evidence 或 admission。

