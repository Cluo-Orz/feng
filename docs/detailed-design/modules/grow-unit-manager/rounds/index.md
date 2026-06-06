# Grow Unit Manager Spec Rounds

本文记录 `Grow Unit Manager` 模块 spec 的检测与调整过程。最终结论见：

```text
docs/detailed-design/modules/grow-unit-manager/spec.md
```

## 输入文档

```text
docs/product-concept.md
docs/agent-research-notes.md
docs/agent-design-learning-summary.md
docs/feng-system-overview-design.md
docs/feng-kernel-and-long-running-design.md
docs/feng-novel-case-flow.md
docs/detailed-design/top-level-module-design.md
docs/detailed-design/modules/domain-model-contracts/spec.md
docs/detailed-design/modules/file-native-store/spec.md
docs/detailed-design/modules/event-ledger-projection/spec.md
docs/detailed-design/modules/artifact-registry/spec.md
docs/detailed-design/modules/policy-capability-boundary/spec.md
docs/detailed-design/modules/skill-registry/spec.md
```

## 轮次

```text
round-01.md
  从“会话管理器/总控循环”纠偏为 grow 单元生命周期管理。

round-02.md
  从“业务大脑”纠偏为跨模块协调者，不拥有 Admission、Agenda、Compiler、Readiness、Hatch 的内部判断。

round-03.md
  收敛无用户 session、单一连续成长空间、可恢复状态机和事件化生命周期边界。
```

## 最终判断

`Grow Unit Manager` 是一个智能行为连续成长空间的业务协调中心。它拥有 grow unit identity、lifecycle、目标边界摘要、当前阶段、关键引用和生命周期事件。它不调用 LLM、不执行工具、不编译 message list、不判断 readiness、不打包 hatch，也不暴露用户需要理解的 session 概念。
