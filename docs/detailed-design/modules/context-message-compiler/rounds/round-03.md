# Context & Message Compiler Spec Round 03

## 当前草稿判断

第三版可以进入最终 spec。关键是明确 message list 的身份：

```text
message list 是当前轮模型可见表示。
message list 是 artifact。
message list 有 source map。
message list 不是事实来源。
```

## 顶层视角检测

产品上用户希望 feng “不断 grow，突然有一天说成了”。这个体验要可信，必须能回答：

```text
本轮为什么这样问模型？
本轮看到了哪些目标、DoD、材料、反馈和边界？
哪些内容因为隐私、状态、预算或不相关被排除？
用了哪些 skill 和 tool，它们为什么可见？
```

如果不能回答这些问题，长程 grow 就会退回不可追踪的聊天。

## 问题

最终 spec 要避免：

```text
把所有 file-native 内容都塞进上下文。
把压缩摘要当完整事实。
把已准入输入默认可见。
把 active skill 默认可见。
把 tool registry 默认全暴露。
把 provider message schema 固化为 feng 内部真相。
```

## 调整

最终 spec 采用：

```text
CompilePlan 描述候选来源、优先级、预算和排除策略。
CompiledMessageListRecord 描述产物、source map、budget、sections 和 provider-neutral messages。
SourceMap 将每个可见片段关联到 ArtifactRef、AgendaRef、FeedbackUnitRef、SkillRef、PolicyDecisionId 或其他 summary。
ExclusionRecord 记录未纳入原因。
CompileReport 解释本轮编译过程。
```

LLM Gateway 之后可以把 provider-neutral message list 转成具体 provider 请求，但不能改写 source map 的事实。

## 进入下一轮的结论

本模块可以进入最终 spec。

最终 spec 必须保留这些硬约束：

```text
Context Compiler 不调用 LLM。
Context Compiler 不执行工具。
Context Compiler 不判断 readiness。
Context Compiler 不决定输入准入。
Message list 是 artifact。
Message list 是投影，不是真相来源。
每次编译都要有来源和排除说明。
```
