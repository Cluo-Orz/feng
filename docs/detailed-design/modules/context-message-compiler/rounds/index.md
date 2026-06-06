# Context & Message Compiler Spec Rounds

本文记录 `Context & Message Compiler` 模块 spec 的检测与调整过程。最终结论见：

```text
docs/detailed-design/modules/context-message-compiler/spec.md
```

## 输入文档

```text
docs/product-concept.md
docs/agent-research-notes.md
docs/agent-design-learning-summary.md
docs/feng-system-overview-design.md
docs/feng-kernel-and-long-running-design.md
docs/detailed-design/top-level-module-design.md
docs/detailed-design/modules/domain-model-contracts/spec.md
docs/detailed-design/modules/file-native-store/spec.md
docs/detailed-design/modules/event-ledger-projection/spec.md
docs/detailed-design/modules/artifact-registry/spec.md
docs/detailed-design/modules/policy-capability-boundary/spec.md
docs/detailed-design/modules/skill-registry/spec.md
docs/detailed-design/modules/grow-unit-manager/spec.md
docs/detailed-design/modules/admission-feedback-inbox/spec.md
docs/detailed-design/modules/agenda-dod-manager/spec.md
```

## 轮次

```text
round-01.md
  拒绝把 Context Compiler 写成 prompt 拼接器。

round-02.md
  补齐 source map、预算、排除理由、skill/tool 可见性说明和 message list artifact 边界。

round-03.md
  收敛为 file-native facts 到模型活跃表示的编译器，不调用 LLM，不执行工具，不拥有事实真相。
```

## 最终判断

`Context & Message Compiler` 是从 grow unit 的 file-native 事实投影出下一轮模型可见 message list 的编译器。它产出 `compiled_message_list` artifact、compile report、source map、budget report 和排除说明。它不调用 LLM，不执行工具，不判断 readiness，不把 message list 当真相来源。
