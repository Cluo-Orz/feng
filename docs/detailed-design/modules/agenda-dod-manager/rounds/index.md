# Agenda & DoD Manager Spec Rounds

本文记录 `Agenda & DoD Manager` 模块 spec 的检测与调整过程。最终结论见：

```text
docs/detailed-design/modules/agenda-dod-manager/spec.md
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
docs/detailed-design/modules/admission-feedback-inbox/spec.md
```

## 轮次

```text
round-01.md
  拒绝把 Agenda 写成 Todo 工具或自然语言计划。

round-02.md
  区分 DoD 定义、验证意图、证据链接和 readiness verdict。

round-03.md
  收敛为缺口、DoD、阻塞项和下一轮 attempt 意图的 file-native 管理层。
```

## 最终判断

`Agenda & DoD Manager` 管理 grow 的目标拆解、缺口、阻塞项、DoD 条目、验证意图和下一轮 attempt 建议。它不执行 attempt，不调用 LLM，不编译 message list，不判断最终 readiness，也不把自然语言计划当成熟证据。
