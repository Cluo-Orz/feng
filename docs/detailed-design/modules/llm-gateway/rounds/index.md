# LLM Gateway Spec Rounds

本文记录 `LLM Gateway` 模块 spec 的检测与调整过程。最终结论见：

```text
docs/detailed-design/modules/llm-gateway/spec.md
```

## 输入文档

```text
docs/agent-research-notes.md
docs/agent-design-learning-summary.md
docs/feng-system-overview-design.md
docs/feng-kernel-and-long-running-design.md
docs/detailed-design/top-level-module-design.md
docs/detailed-design/modules/domain-model-contracts/spec.md
docs/detailed-design/modules/artifact-registry/spec.md
docs/detailed-design/modules/policy-capability-boundary/spec.md
docs/detailed-design/modules/context-message-compiler/spec.md
```

## 轮次

```text
round-01.md
  拒绝把 LLM Gateway 写成 provider SDK 薄包装。

round-02.md
  区分 provider request/response normalization 与 prompt 语义、工具执行、readiness。

round-03.md
  收敛为 provider-neutral message list 到 provider 调用的协议适配与错误归一化层。
```

## 最终判断

`LLM Gateway` 封装 provider/model 能力摘要、provider request 转换、streaming event normalization、tool-call block normalization、usage/finish reason 归一化、错误分类、retry/fallback 的底层执行。它不拥有 prompt 语义，不编译 message list，不执行工具，不判断 readiness。
