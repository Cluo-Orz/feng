# Event Ledger & Projection 轮次索引

模块最终 spec 见：

```text
docs/detailed-design/modules/event-ledger-projection/spec.md
```

## 轮次

```text
round-01.md：初稿检测，纠正“普通日志文件”的风险。
round-02.md：补充 event envelope、stream、sequence、idempotency 和 projection。
round-03.md：检测与最终调整，明确 Ledger 是事实源，Projection 是可重建视图。
```

## 上游依据

```text
docs/detailed-design/modules/domain-model-contracts/spec.md
docs/detailed-design/modules/file-native-store/spec.md
docs/detailed-design/top-level-module-design.md
docs/agent-design-learning-summary.md
docs/agent-research-notes.md
```
