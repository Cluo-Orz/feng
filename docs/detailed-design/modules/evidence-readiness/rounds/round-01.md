# Evidence & Readiness Spec Round 01

## 当前草稿判断

第一版草稿容易把 readiness 写成：

```text
让模型回顾当前结果。
模型判断是否完成。
如果模型说可以，就 ready_to_hatch。
```

这个方向必须拒绝。它会把 feng 拉回“模型自信即完成”的陷阱。

## 顶层视角检测

feng 的产品承诺是可恢复、可审计、可验证的成长。readiness 不是一种情绪判断，而是当前目标边界下的证据裁决。

成熟 agent 系统的可借鉴点不是“让模型更会自评”，而是：

```text
任务有状态。
输出有 trace。
工具和运行环境有结果。
反馈有归因。
完成条件有 DoD。
发布前有验证证据。
```

## 问题

```text
模型自评不可复现。
模型回答不能说明目标世界真的可运行。
工具成功不能说明 DoD 满足。
attempt completed 不能说明 grow 完成。
缺少证据时继续生成会掩盖问题。
```

## 调整

将模块定位改为：

```text
证据候选、DoD evaluation 和 readiness verdict 的 owning module。
```

补入以下终态对象：

```text
EvidenceRecord
EvidenceCandidate
EvidenceQuality
EvidenceRelation
DoDEvaluation
ReadinessAssessment
ReadinessVerdict
ReadinessGap
ReadinessReport
```

## 进入下一轮的结论

Readiness 必须基于证据，而不是模型自信。下一轮要检测它是否又走向另一个极端：变成一个过大的验证执行平台。

