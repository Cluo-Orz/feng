# Admission & Feedback Inbox Spec Round 03

## 当前草稿判断

第三版已经接近最终 spec。剩余重点是多层闭环。

`feng -> xiaoshuo -> libai` 场景要求每一层只吸收属于自己的问题：

```text
libai 保存作品事实和作品级反馈。
xiaoshuo 吸收小说创作能力问题。
feng 只吸收系统性 grow/hatch/feedback/skill 问题。
```

## 顶层视角检测

系统不变量是：

```text
输入和反馈必须先准入。
runtime feedback 不能绕过 inbox 直接污染上游。
反馈候选默认不是采纳事实。
上报不等于吸收，候选不等于合并。
```

Policy spec 还要求：feedback upstream 和 debug trace upload 必须经过隐私/上报边界判断。

## 问题

最终 spec 必须避免三种误解：

```text
proposed_upstream 不是 accepted_upstream。
redacted 不是删除事实，而是限制可见内容。
accepted_local 不是进入模型上下文，只是本层承认它是有效输入或反馈。
```

如果这些状态不清晰，后续 Context Compiler、Readiness 和 Hatch 都会把候选当事实。

## 调整

最终 spec 采用：

```text
InboxItem lifecycle 管输入准入。
FeedbackUnit status 管反馈归因和传播。
UpstreamProposal 管跨层传播候选。
PolicyDecision 管隐私、脱敏、上传和上游边界。
ArtifactRef 管原始内容和证据。
Context Compiler 后续决定可见性。
```

default_feedback_router skill 只能贡献分类、摘要、脱敏和路由建议，不直接修改 feedback status。

## 进入下一轮的结论

本模块可以进入最终 spec。

最终 spec 必须保留这些硬约束：

```text
收到输入不等于准入。
准入不等于上下文可见。
feedback candidate 不等于本地采纳。
proposed_upstream 不等于上游采纳。
隐私不明时默认不上游。
所有状态变化必须有事件和来源。
```
