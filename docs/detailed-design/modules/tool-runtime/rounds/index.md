# Tool Runtime Spec Rounds

本文索引 `Tool Runtime` 模块 spec 的检测与调整过程。

## 输入文档

```text
docs/product-concept.md
docs/feng-system-overview-design.md
docs/feng-kernel-and-long-running-design.md
docs/agent-design-learning-summary.md
docs/detailed-design/top-level-module-design.md
docs/detailed-design/module-spec-process.md
docs/detailed-design/modules/domain-model-contracts/spec.md
docs/detailed-design/modules/file-native-store/spec.md
docs/detailed-design/modules/event-ledger-projection/spec.md
docs/detailed-design/modules/artifact-registry/spec.md
docs/detailed-design/modules/policy-capability-boundary/spec.md
docs/detailed-design/modules/skill-registry/spec.md
docs/detailed-design/modules/context-message-compiler/spec.md
docs/detailed-design/modules/llm-gateway/spec.md
```

## 轮次

```text
round-01.md
  检测“工具执行器”草稿是否过薄，补齐 registry、policy、artifact 和 settlement。

round-02.md
  检测是否膨胀成插件平台或工具可见性中心，收回到只读工具面与执行边界。

round-03.md
  检测是否污染 grow state、message list 或 readiness，固定 Tool Runtime 的终态边界。
```

## 最终结论

最终 spec 位于：

```text
docs/detailed-design/modules/tool-runtime/spec.md
```

