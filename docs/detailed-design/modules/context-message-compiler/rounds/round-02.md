# Context & Message Compiler Spec Round 02

## 当前草稿判断

第二版已经有 source map 和 compile report，但仍可能变成“上下文大脑”：它可能开始判断哪些反馈是真的、哪些 DoD 满足、哪些工具可以执行。

这会越过 Admission、Agenda、Evidence、Policy 和 Tool Runtime。

## 顶层视角检测

已完成模块边界是：

```text
Admission 决定输入和反馈准入状态。
Agenda 决定 DoD 定义、缺口和 AttemptIntent。
Artifact Registry 提供 preview、materialization、privacy 和 lifecycle。
Skill Registry 提供 skill candidate、summary 和 body materialization。
Policy 提供边界和权限 decision。
Grow Unit Manager 提供 lifecycle snapshot。
```

Context Compiler 只把这些事实编译成活跃表示。

## 问题

第二版需要修正：

```text
可见不等于采纳。
摘要不等于原文。
tool visible 不等于 tool executable。
skill visible 不等于 skill active 或 skill trusted。
compile success 不等于 attempt success。
```

Tool Runtime 还未设计，因此 Context Compiler 不能直接依赖它。它只能使用调用方提供的 ToolSurfaceSummary 或后续 Tool Runtime 导出的只读 summary contract。

## 调整

第三版规定：

```text
Context Compiler 不直接 import LLM Gateway 或 Tool Runtime。
Context Compiler 不执行 tool，不验证 tool input。
Tool visibility 只写入 message list 的工具可见说明和来源。
Skill visibility 必须引用 Skill Registry 的 materialization 和 policy/source。
所有 redacted/unavailable/retracted artifact 都显式记录处理方式。
```

## 进入下一轮的结论

下一轮需要明确最终 message list 结构：

```text
不是 provider request schema。
不是完整 prompt 模板。
是 feng 内部可检查的 compiled message list artifact。
它可以被 LLM Gateway 后续转换成 provider 请求。
```
