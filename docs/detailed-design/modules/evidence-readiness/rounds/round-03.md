# Evidence & Readiness Spec Round 03

## 当前草稿判断

第三版草稿还要防止 Evidence & Readiness 过度“有权力”：

```text
直接采纳 feedback。
直接修改 Agenda/DoD。
直接把 grow unit 改成 ready_to_hatch。
直接让 Hatch Builder 打包。
```

这些都会破坏模块分工。

## 顶层视角检测

证据裁决应该只给出 verdict 和解释。后续动作属于其他模块：

```text
Admission & Feedback Inbox 决定反馈状态。
Agenda & DoD Manager 定义和修订 DoD。
Grow Unit Manager 应用 readiness verdict 到 lifecycle。
Hatch Builder 根据 ready_to_hatch 和边界检查构建 package。
```

Readiness verdict 是关键输入，但不是跨模块万能命令。

## 问题

```text
如果 feedback candidate 直接成为 evidence accepted，会绕过准入。
如果 DoD failed 直接改 Agenda，会让失败原因不可审计。
如果 ready_to_hatch 直接触发 hatch，会缺少发布边界和 package 选择。
如果证据隐私未知仍被使用，会污染上游和 hatch。
```

## 调整

固定以下终态规则：

```text
Evidence candidate 不等于 accepted evidence。
Feedback candidate 必须先经过 Admission。
DoD evaluation 不修改 DoD。
ReadinessVerdict 不直接改 grow lifecycle。
ready_to_hatch 不直接构建 hatch package。
隐私未知或 artifact 不可读的证据不能支撑 ready_to_hatch。
```

## 进入下一轮的结论

Evidence & Readiness spec 可以收敛。它是证据与 readiness 的裁决层，但所有跨生命周期动作都通过对应 owning module 完成。

