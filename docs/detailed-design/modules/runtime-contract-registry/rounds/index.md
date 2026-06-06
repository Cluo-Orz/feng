# Runtime Contract Registry Spec Rounds

本文索引 `Runtime Contract Registry` 模块 spec 的检测与调整过程。

## 输入文档

```text
docs/product-concept.md
docs/feng-system-overview-design.md
docs/feng-kernel-and-long-running-design.md
docs/agent-design-learning-summary.md
docs/detailed-design/top-level-module-design.md
docs/detailed-design/module-spec-process.md
docs/detailed-design/modules/artifact-registry/spec.md
docs/detailed-design/modules/policy-capability-boundary/spec.md
docs/detailed-design/modules/grow-unit-manager/spec.md
docs/detailed-design/modules/evidence-readiness/spec.md
```

## 轮次

```text
round-01.md
  检测“API schema 仓库”草稿是否过窄，扩展为运行契约边界。

round-02.md
  检测是否变成 agent 模板中心，固定 kernel type 多形态和目标世界边界。

round-03.md
  检测是否与 hatch package、runtime implementation、feedback 上报混淆，固定 contract lifecycle 和版本边界。
```

## 最终结论

最终 spec 位于：

```text
docs/detailed-design/modules/runtime-contract-registry/spec.md
```

