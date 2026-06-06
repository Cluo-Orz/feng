# Context & Message Compiler Spec Round 01

## 当前草稿判断

第一版很容易写成 prompt 拼接器：

```text
读目标。
读历史。
读材料。
读 skill。
拼成 messages。
```

这个方向不够。feng 的 message list 必须是文件化产物，能解释它从哪些目标、材料、反馈、约束和证据编译而来。

## 顶层视角检测

系统概要设计要求：

```text
文件事实层是真相来源，message list 是当前轮投影。
模型看到的是活跃表示，不是完整事实。
压缩只改变活跃表示，不应该改写事实层。
下一轮 message list 必须能说明看到了什么、没看到什么、为什么。
```

调研结论也指出：下一轮模型输入不是随手拼 prompt，而是由持久状态编译出来的。

## 问题

prompt 拼接器草稿有四个问题：

```text
没有 source map，无法解释模型看到了什么。
没有排除理由，无法解释为什么某些事实没进入上下文。
没有预算报告，压缩会变成静默丢失。
没有 artifact 边界，message list 会继续只是临时请求体。
```

更严重的是，它可能把 message list 当成真相来源，反过来污染后续 grow。

## 调整

第二版改为编译器：

```text
输入是 GrowUnitSnapshot、AdmissionSummary、AgendaSummary、AttemptIntent、SkillCandidate、Artifact metadata 和 policy boundary。
输出是 compiled_message_list artifact。
同时输出 compile report、source map、budget report 和 exclusion list。
每个 section、message、skill、tool 和材料片段都有来源和纳入原因。
```

## 进入下一轮的结论

下一轮需要检查：

```text
Context Compiler 是否越权决定事实采纳。
Context Compiler 是否直接依赖 Tool Runtime 或 LLM Gateway。
skill 和 tool 可见性如何表达但不执行。
redacted/unavailable artifact 如何处理。
```
