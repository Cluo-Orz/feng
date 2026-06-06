# Tool Runtime Spec Round 02

## 当前草稿判断

第二版草稿补齐了 registry、policy、artifact 和 settlement，但出现了另一个风险：Tool Runtime 可能膨胀成统一插件平台。

这种倾向会把以下职责吸进 Tool Runtime：

```text
决定本轮哪些工具进入 message list。
根据 skill 自动启用工具。
管理插件生态、MCP adapter 或工具市场。
解释 grow 目标后选择工具策略。
把工具执行结果直接做上下文压缩。
```

这些职责会让模块边界变重，也会让 feng 被调研对象的产品形态牵着走。

## 顶层视角检测

feng 的用户心智不是“配置一个工具平台”，而是“在一个目录里让一个智能行为持续成长并最终 hatch”。工具是 grow 和 runtime 的能力边界，不是产品中心。

已经完成的 spec 给出了约束：

```text
Skill Registry 不注册工具，也不授予工具权限。
Context & Message Compiler 决定本轮 message list 的 visible tools。
LLM Gateway 只归一化 tool-call block，不执行工具。
Policy & Capability Boundary 决定动作边界，但不执行动作。
Artifact Registry 只登记 tool_result，不判断工具成功。
```

因此 Tool Runtime 应提供工具面摘要和执行事实，不应拥有 prompt visibility 或 grow 策略。

## 问题

```text
如果 Tool Runtime 决定 visible tools，会与 Context Compiler 冲突。
如果 Tool Runtime 根据 skill 自动启用工具，会与 Skill Registry 和 Policy 冲突。
如果 Tool Runtime 保存插件市场语义，会过早进入扩展生态设计。
如果 Tool Runtime 直接摘要工具结果进入下一轮上下文，会破坏 message list 是编译产物的不变量。
```

## 调整

收紧边界：

```text
Tool Runtime 只描述 tool surface candidate。
Context Compiler 决定本轮 visible tools。
visible tool 不等于 executable tool。
Skill declaredToolRefs 不注册工具。
PolicyDecision 允许不等于执行成功。
工具结果只成为 tool_result artifact、receipt 和 settlement。
上下文是否使用工具结果由后续编译决定。
```

同时明确：

```text
Tool Runtime 不直接依赖 LLM Gateway。
Tool Runtime 不导入 Context Compiler 的编译逻辑。
Grow Attempt Runner 是 LLM tool-call block 与 Tool Runtime 执行之间的编排者。
```

## 进入下一轮的结论

Tool Runtime 的边界已经从“工具平台”收回为“工具执行事实层”。下一轮需要检测它是否仍可能污染 grow state、readiness 或 hatch。

