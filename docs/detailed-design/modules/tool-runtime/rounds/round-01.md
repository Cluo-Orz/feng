# Tool Runtime Spec Round 01

## 当前草稿判断

第一版草稿容易把 `Tool Runtime` 写成一个简单函数调用器：

```text
收到 tool call。
找到工具实现。
执行工具。
返回结果。
```

这个草稿太薄。它不能支撑 feng 的 file-native、可审计、长程 grow 和安全边界要求。

## 顶层视角检测

从顶层模块看，工具调用是 grow 过程中少数会产生真实外部效果的动作。它不只是模型输出后的辅助调用，而是涉及：

```text
工具定义是否可信。
工具输入是否符合 schema。
动作是否被 policy 允许。
执行是否有超时、取消和并发边界。
结果如何归档成 artifact。
错误如何被归一化。
Grow Attempt Runner 如何等待并结算这次调用。
```

如果只写“执行工具并返回结果”，Tool Runtime 会把关键事实丢在进程内存里，后续 message list、attempt trace、evidence 和 hatch 都无法解释工具到底做了什么。

## 问题

```text
缺少 tool registry，无法表达工具来源、版本、状态和风险。
缺少 ToolSurfaceSummary，Context Compiler 无法解释 visible tools 的来源。
缺少输入校验，模型提出的 tool call 会被误当成可信命令。
缺少 policy decision，工具执行可能绕过能力边界。
缺少 tool result artifact，大输出会污染上下文。
缺少 settlement，Grow Attempt Runner 无法区分失败、超时、取消和 policy blocked。
```

## 调整

将模块定位从“执行函数”调整为：

```text
工具定义、工具面摘要、工具调用校验、policy enforce、执行、结果归档和 settlement 的事实层。
```

补入以下核心事实：

```text
ToolDefinition
ToolLifecycle
ToolSurfaceSummary
ToolCallRequest
ToolInputValidation
ToolExecutionReceipt
ToolResultArtifact
ToolSettlement
ToolErrorClassification
```

## 进入下一轮的结论

Tool Runtime 必须比普通 tool executor 更强，但下一轮要继续检测它是否过强，尤其是否侵入 Context Compiler 的工具可见性选择或演变成插件平台。

