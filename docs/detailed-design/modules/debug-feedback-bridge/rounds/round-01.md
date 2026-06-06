# Debug & Feedback Bridge Spec Round 01

## 当前草稿判断

第一版直觉容易把这个模块写成：

```text
runtime 开 debug mode。
runtime 每轮上报 trace。
feng 接收 trace。
feng 根据 trace 自动 grow。
```

这个草稿的问题不是能力不够，而是边界太危险。它会把“调试材料”误当成“上游事实”，让下游项目直接牵引 feng。

## 顶层视角检测

从产品终态看，feng 的多层闭环必须存在，但每层反馈都只能先成为候选。

必须保留这些边界：

```text
RuntimeTrace 不等于 FeedbackUnit。
DebugSignal 不等于 feedback accepted。
feedback candidate 不等于 accepted_local。
proposed_upstream 不等于 accepted_upstream。
runtime feedback 不能绕过 inbox 直接污染上游。
```

## 问题

当前草稿缺少：

```text
调试关联链。
跨 runtime invocation 的 causation。
反馈候选包。
隐私过滤。
归因记录。
Admission 边界。
PolicyDecision。
```

如果直接把 trace 上报到上游，`libai-chongshengle` 的小说正文、项目偏好或一次局部失败可能错误进入 `xiaoshuo` 或 `feng`。

## 调整

引入：

```text
DebugCorrelation。
RuntimeReportEnvelope。
FeedbackAttribution。
PrivacyFilterResult。
FeedbackBridgePacket。
UpstreamProposalRequest。
```

调整后的事实：

```text
Bridge 负责把调试材料整理成候选包。
FeedbackUnit 仍由 Admission & Feedback Inbox 创建。
UpstreamProposal 仍由 Admission & Feedback Inbox 创建。
Bridge 只记录来源链和提交回执。
```

## 进入下一轮的结论

下一轮重点检查：Bridge 会不会因为“生成反馈候选”而变成反馈状态机、grow 监督者或 agent creator。

