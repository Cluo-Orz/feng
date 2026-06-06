# Evidence & Readiness Spec Round 02

## 当前草稿判断

第二版草稿把证据和 DoD evaluation 建起来了，但容易膨胀成 eval runner 或目标世界验证平台。

风险包括：

```text
直接运行测试命令。
直接调用游戏模拟器。
直接执行 target world action。
直接调用 LLM judge。
直接生成验证环境。
```

这些职责会让 Evidence & Readiness 和 Tool Runtime、Target World Adapter、LLM Gateway、CLI 混在一起。

## 顶层视角检测

Evidence & Readiness 应该解释证据，而不是执行所有验证。验证可以来自：

```text
Grow Attempt Runner 的 outcome。
Tool Runtime 的 tool_result。
Target World Adapter 未来产生的 validation report。
Debug & Feedback Bridge 未来产生的 runtime trace。
人工 review。
外部测试报告。
```

本模块的职责是把这些来源转成可追溯的 evidence record，并对 DoD 做 evaluation。

## 问题

```text
如果 Evidence 自己执行工具，会绕过 Tool Runtime。
如果 Evidence 自己调用 LLM，会把模型评审伪装成证据裁决。
如果 Evidence 自己接目标世界，会与 Target World Adapter 冲突。
如果 Evidence 自己改 DoD，会与 Agenda 冲突。
```

## 调整

收紧边界：

```text
Evidence & Readiness 不执行工具。
Evidence & Readiness 不调用 LLM。
Evidence & Readiness 不运行目标世界。
Evidence & Readiness 不创建 DoD。
Evidence & Readiness 只登记、分类、解释和评价证据。
```

同时允许：

```text
LLM judge 的输出可以作为 validation_report artifact 候选，但必须标记 source 和 evidence quality。
工具测试报告可以作为 validation_report artifact，但执行归 Tool Runtime 或外部环境。
人工确认可以作为 manual_review evidence，但也必须有 scope 和 source。
```

## 进入下一轮的结论

Evidence & Readiness 是证据解释和 verdict 层，不是验证执行平台。下一轮要检测它是否绕过 Admission、Agenda 或 Grow Unit Manager 的状态边界。

