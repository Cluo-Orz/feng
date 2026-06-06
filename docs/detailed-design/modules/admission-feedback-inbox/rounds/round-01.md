# Admission & Feedback Inbox Spec Round 01

## 当前草稿判断

第一版容易把它写成普通输入队列：

```text
接收用户消息。
扫描目录新增文件。
接收 runtime 上报。
把这些内容交给下一轮 grow。
```

这个方向错误。feng 的核心约束是：进入目录或收到上报不等于进入下一轮模型上下文。

## 顶层视角检测

顶层模块设计明确说：

```text
Admission & Feedback Inbox 处理用户输入、材料、调试上报、反馈单元和外部事件的准入。
输入来源、版本、隐私边界和初步类型必须可记录。
任何输入都要先成为可追踪候选。
```

调研结论也指向同一件事：用户材料、调试上报和反馈不能一进入目录就污染下一轮 message list，必须经过 grow 单元准入、采纳、拒绝或等待。

## 问题

输入队列草稿有四个问题：

```text
把收到内容等同于可用材料。
把 runtime feedback 等同于上游事实。
把目录变化等同于上下文变化。
把模型总结等同于经验吸收。
```

这会破坏 file-native 的可信性。file-native 不是把所有内容都塞进上下文，而是让关键输入、状态和决策可追踪。

## 调整

第二版引入准入状态：

```text
InboxItem 表示收到的输入或外部事件。
AdmissionDecision 表示接受、拒绝、等待证据、等待确认、隔离、脱敏或转为 feedback candidate。
FeedbackUnit 表示运行反馈或下游上报。
FeedbackStatus 表示 candidate、accepted_local、proposed_upstream、rejected、ignored、waiting_evidence、waiting_human、redacted。
```

Inbox 只负责准入和反馈状态，不负责 message list 编译。

## 进入下一轮的结论

下一轮需要检查：

```text
Inbox 是否与 Artifact Registry 内容管理重叠。
Inbox 是否与 Policy 的隐私和上报边界重叠。
Inbox 是否与 Grow Unit Manager lifecycle 重叠。
Feedback 状态是否足够支撑多层回流。
```
