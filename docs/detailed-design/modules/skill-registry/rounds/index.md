# Skill Registry Spec Rounds

本文记录 `Skill Registry` 模块 spec 的检测与调整过程。最终结论见：

```text
docs/detailed-design/modules/skill-registry/spec.md
```

## 输入文档

```text
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
```

## 轮次

```text
round-01.md
  拒绝把 Skill Registry 设计成插件市场或 prompt 自动拼装器。

round-02.md
  明确 skill descriptor、body、activation、version、source、evidence 和 rollback 的边界。

round-03.md
  收敛默认 feedback router skill 的职责：默认存在、可演进、可审计，但不直接吸收上游反馈。
```

## 最终判断

`Skill Registry` 是 skill 的 file-native catalog 和 lifecycle 管理层。它管理 skill 的发现、注册、版本、来源、启用状态、作用域、body artifact、按需加载、禁用、pin、rollback 和默认 feedback router skill。它不自动把 skill 塞进 prompt，不执行 skill，不管理工具运行，也不决定反馈采纳。
