# Admission & Feedback Inbox Spec Round 02

## 当前草稿判断

第二版已经有候选和状态，但仍可能把准入写成“业务判断总入口”。

如果所有输入都由 Inbox 决定是否进入目标、DoD、上下文、readiness 和 hatch，它就会变成另一个大脑。

## 顶层视角检测

已完成模块边界要求：

```text
Artifact Registry 保存大内容、preview、privacy、retention 和 lifecycle。
Policy & Capability Boundary 判断 feedback upstream、debug trace upload 和隐私边界。
Skill Registry 提供 default_feedback_router 策略贡献，但不直接改 feedback status。
Grow Unit Manager 只关联 Admission 状态 summary。
Context & Message Compiler 决定哪些已准入内容进入 message list。
```

Inbox 必须只拥有准入和反馈状态。

## 问题

第二版还缺三类边界：

```text
输入材料和反馈单元不能混在一个状态机里。
上游提议必须先经过 policy 和隐私检查。
accepted_local 不等于进入 message list，也不等于能力成熟。
```

尤其是小说场景：作品原文可以作为 libai 项目的本地材料，但不应该默认上报到 xiaoshuo 或 feng。

## 调整

第三版拆分：

```text
InboxItemRecord：记录收到的输入、材料、文件变化或外部事件。
AdmissionRecord：记录某个 item 的准入决策。
FeedbackUnitRecord：记录运行问题、证据、归因、建议和状态。
UpstreamProposal：记录向上游提出的候选包，不表示上游已经采纳。
```

Policy 负责判断是否允许上报、导出或脱敏。Artifact Registry 负责保存原文、trace 和证据。Inbox 保存状态和引用。

## 进入下一轮的结论

下一轮需要专门收敛多层反馈：

```text
如何表达 origin layer、target layer 和 attribution。
如何确保上报不等于吸收。
如何让 default_feedback_router 参与但不越权。
如何让 Context Compiler 后续能解释某个内容为什么可见或不可见。
```
