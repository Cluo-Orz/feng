# Event Ledger & Projection Spec Round 01

## 当前草稿判断

初稿容易把 Event Ledger 写成简单日志：

```text
appendLog。
readLog。
listEvents。
```

这个方向不足以支撑 feng 的长程 grow、恢复、审计和回放。

## 顶层视角检测

从产品概念看，feng 的关键问题是“下一轮为什么这样继续 grow”必须能被文件证据解释。普通日志只记录发生过什么，无法稳定支持状态投影、版本检查和恢复。

从 opencode 看，durable events、projection history 和 context epoch 都说明：事件事实和模型可见历史/当前状态必须分层。CodeWhale 的 runtime timeline 也说明事件要能 replay，而不是只是打印。

## 问题

```text
1. 普通日志没有顺序和 idempotency，崩溃重试会重复写入。
2. 普通日志没有投影，业务模块仍会从各处文件拼状态。
3. 普通日志没有版本边界，未来 schema 变更会静默误读。
4. 普通日志可能塞入大 payload，污染事件事实和上下文。
```

## 调整

Event Ledger 应定义为：

```text
append-only 事件事实源。
带 event envelope、stream、sequence、source、version、correlation 的持久事件。
可重放事件流。
可重建 projection。
重复写入和版本不兼容的显式处理。
```

## 进入下一轮的结论

Round 02 需要定义 event envelope、stream、idempotency、projection cache 和与 File Store/Artifact Registry 的边界。
