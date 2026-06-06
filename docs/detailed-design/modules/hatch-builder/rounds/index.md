# Hatch Builder Spec Rounds

本文索引 `Hatch Builder` 模块 spec 的检测与调整过程。

## 输入文档

```text
docs/product-concept.md
docs/feng-system-overview-design.md
docs/feng-kernel-and-long-running-design.md
docs/agent-design-learning-summary.md
docs/detailed-design/top-level-module-design.md
docs/detailed-design/module-spec-process.md
docs/detailed-design/modules/evidence-readiness/spec.md
docs/detailed-design/modules/runtime-contract-registry/spec.md
docs/detailed-design/modules/artifact-registry/spec.md
docs/detailed-design/modules/policy-capability-boundary/spec.md
docs/detailed-design/modules/skill-registry/spec.md
docs/detailed-design/modules/grow-unit-manager/spec.md
```

## 轮次

```text
round-01.md
  检测“复制 grow 目录”草稿，改成稳定能力提取和 package manifest。

round-02.md
  检测是否退化成 prompt wrapper，固定 runtime contract、资源、skill、debug、feedback 和版本边界。

round-03.md
  检测发布、secret、自动更新和回滚风险，固定 policy、排除清单和不可变 package version。
```

## 最终结论

最终 spec 位于：

```text
docs/detailed-design/modules/hatch-builder/spec.md
```

