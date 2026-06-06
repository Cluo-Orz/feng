# Target World Adapter Spec Rounds

本文索引 `Target World Adapter` 模块 spec 的检测与调整过程。

## 输入文档

```text
docs/product-concept.md
docs/feng-system-overview-design.md
docs/feng-kernel-and-long-running-design.md
docs/agent-design-learning-summary.md
docs/detailed-design/top-level-module-design.md
docs/detailed-design/module-spec-process.md
docs/detailed-design/modules/runtime-contract-registry/spec.md
docs/detailed-design/modules/hatch-builder/spec.md
docs/detailed-design/modules/policy-capability-boundary/spec.md
docs/detailed-design/modules/artifact-registry/spec.md
docs/detailed-design/modules/evidence-readiness/spec.md
```

## 轮次

```text
round-01.md
  检测“对话接口适配器”草稿，改成多目标世界输入/动作/事件边界。

round-02.md
  检测是否膨胀成目标世界平台或游戏/小说引擎，收回到归一化和 contract 边界。

round-03.md
  检测 debug、validation、feedback 是否污染上游，固定候选、policy 和 admission 边界。
```

## 最终结论

最终 spec 位于：

```text
docs/detailed-design/modules/target-world-adapter/spec.md
```

