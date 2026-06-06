# Grow Attempt Runner Spec Rounds

本文索引 `Grow Attempt Runner` 模块 spec 的检测与调整过程。

## 输入文档

```text
docs/product-concept.md
docs/feng-system-overview-design.md
docs/feng-kernel-and-long-running-design.md
docs/agent-design-learning-summary.md
docs/detailed-design/top-level-module-design.md
docs/detailed-design/module-spec-process.md
docs/detailed-design/modules/grow-unit-manager/spec.md
docs/detailed-design/modules/admission-feedback-inbox/spec.md
docs/detailed-design/modules/agenda-dod-manager/spec.md
docs/detailed-design/modules/context-message-compiler/spec.md
docs/detailed-design/modules/llm-gateway/spec.md
docs/detailed-design/modules/tool-runtime/spec.md
```

## 轮次

```text
round-01.md
  检测“简单 LLM loop”草稿是否缺少 file-native trace、checkpoint 和可恢复性。

round-02.md
  检测是否膨胀成隐藏大脑，收回到只消费 AttemptIntent、不判断 readiness 的执行编排层。

round-03.md
  检测 provider session、工具输出直塞上下文和长期状态污染风险，固定每轮 message list artifact 与恢复边界。
```

## 最终结论

最终 spec 位于：

```text
docs/detailed-design/modules/grow-attempt-runner/spec.md
```

