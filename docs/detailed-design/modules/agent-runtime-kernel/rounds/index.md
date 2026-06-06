# Agent Runtime Kernel Spec Rounds

本文索引 `Agent Runtime Kernel` 模块 spec 的检测与调整过程。

## 输入文档

```text
docs/product-concept.md
docs/feng-system-overview-design.md
docs/feng-kernel-and-long-running-design.md
docs/agent-design-learning-summary.md
docs/detailed-design/top-level-module-design.md
docs/detailed-design/module-spec-process.md
docs/detailed-design/modules/runtime-contract-registry/spec.md
docs/detailed-design/modules/target-world-adapter/spec.md
docs/detailed-design/modules/context-message-compiler/spec.md
docs/detailed-design/modules/llm-gateway/spec.md
docs/detailed-design/modules/tool-runtime/spec.md
```

## 轮次

```text
round-01.md
  检测“prompt wrapper”草稿，补齐 runtime message list、trace、tool/action loop 和 contract enforcement。

round-02.md
  检测是否复制 Grow Kernel 或成为 feng 产品中心，收回为 hatch agent 的可选运行底座。

round-03.md
  检测长期记忆、debug feedback 和生产自修改风险，固定 file-native、candidate 和版本锁定边界。
```

## 最终结论

最终 spec 位于：

```text
docs/detailed-design/modules/agent-runtime-kernel/spec.md
```

