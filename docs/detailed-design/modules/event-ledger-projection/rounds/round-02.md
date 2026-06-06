# Event Ledger & Projection Spec Round 02

## 当前草稿判断

第二轮草稿引入：

```text
EventEnvelope。
LedgerStream。
SequenceNumber。
IdempotencyKey。
Projection。
ProjectionCheckpoint。
```

## 顶层视角检测

从 Domain Model & Contracts 看，事件应使用 EventId、SourceDescriptor、VersionDescriptor、AuditDescriptor、ArtifactRef 等共享语言。

从 File-Native Store 看，Ledger 可以使用 append primitive 和 receipt，但不能把 receipt 当业务事件。事件 append 成功后，应由 Ledger 返回自己的 EventAppendReceipt 或 EventRef。

从 Artifact Registry 的未来职责看，大 payload 不应直接进入 event body。事件应引用 artifact。

## 问题

```text
1. 如果 event payload 太自由，业务模块会把任意对象塞进事件。
2. 如果 projection 是手写状态文件，可能被当成真相来源。
3. 如果事件可以修改，回放和审计失效。
4. 如果所有事件共用一个全局序列，第一阶段实现可能变重；如果只有局部序列，跨流排序要有解释。
```

## 调整

终态边界：

```text
Event Ledger 拥有事件 envelope、append、read、replay、projection rebuild。
业务模块拥有具体事件 type 的语义。
Projection 是缓存/视图，可重建，不是真相来源。
大 payload 使用 ArtifactRef。
事件不可修改；纠错通过 superseding event。
每个 stream 有严格递增序列；跨 stream 使用 timestamp/correlation，不承诺全局事务排序。
```

## 进入下一轮的结论

Round 03 需要检查这个模块是否会越界成业务状态机，并定稿其不变量、ports、错误和验证要求。
