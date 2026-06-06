# Admission & Feedback Inbox Spec Rounds

本文记录 `Admission & Feedback Inbox` 模块 spec 的检测与调整过程。最终结论见：

```text
docs/detailed-design/modules/admission-feedback-inbox/spec.md
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
docs/detailed-design/modules/grow-unit-manager/spec.md
```

## 轮次

```text
round-01.md
  拒绝把 inbox 写成“收到即进入上下文”的输入队列。

round-02.md
  区分输入材料准入、反馈单元状态、隐私/上游 policy 和 message list 可见性。

round-03.md
  收敛多层反馈归因：本地候选、上游提议、拒绝、等待证据、脱敏，不自动吸收。
```

## 最终判断

`Admission & Feedback Inbox` 是用户输入、材料、运行上报、调试 trace、外部事件和反馈单元的准入与状态管理层。它保证所有输入先成为可追踪候选，再经过分类、隐私检查、证据关联和状态转换。它不编译 message list，不判断 readiness，不把反馈自动写入上游 grow。
