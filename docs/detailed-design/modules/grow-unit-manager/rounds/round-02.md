# Grow Unit Manager Spec Round 02

## 当前草稿判断

第二版已经避开 session，但还容易写成“业务大脑”：所有模块都把判断交给它，它决定下一步要做什么、该看什么、是否 ready、是否 hatch。

这会让它成为隐形上帝对象。

## 顶层视角检测

顶层模块设计已经把 Grow Kernel 拆开：

```text
Grow Unit Manager 拥有 grow lifecycle 和业务协调。
Admission & Feedback Inbox 拥有输入与反馈准入。
Agenda & DoD Manager 拥有目标拆解、缺口和 DoD。
Context & Message Compiler 拥有模型可见表示。
Grow Attempt Runner 拥有 attempt 执行过程。
Evidence & Readiness 拥有 readiness verdict。
Hatch Builder 拥有能力包生成过程。
```

Grow Unit Manager 是协调中心，不是所有判断的归宿。

## 问题

过度中心化会带来四个问题：

```text
它会绕过 Admission，把进入目录的材料直接当作 grow 状态。
它会绕过 Agenda，把目标边界、DoD 和缺口混成一个自然语言字段。
它会绕过 Readiness，用 lifecycle 直接表达“模型觉得成了”。
它会绕过 Hatch，把 grow 目录和 hatch package 混在一起。
```

这会让长程任务重新退化为“多轮模型自信”。

## 调整

第三版把 Grow Unit Manager 限定为状态机与协调记录：

```text
它拥有 grow unit record 和 lifecycle transition。
它维护当前目标边界 summary，但不拥有完整 Agenda/DoD。
它保存 Admission、Agenda、Attempt、MessageList、Readiness、Hatch 的 Ref。
它根据其他模块提交的结果推进生命周期。
它只写 grow_unit stream 事件。
```

例如：

```text
Admission 表示关键材料缺失 -> Manager 可进入 waiting_input。
Agenda 表示有可执行下一步 -> Manager 可保持 planning/growing。
Readiness 给出 ready_to_hatch verdict -> Manager 可进入 ready_to_hatch。
Hatch Builder 生成 package -> Manager 可进入 hatched。
```

## 进入下一轮的结论

下一轮需要确定：

```text
grow unit record 的最小事实。
生命周期状态和 transition 不变量。
一个 grow 单元下只有一个连续成长轨迹，如何避免 session/fork 心智。
长程恢复时 Manager 提供什么 snapshot，又不越界编译 message list。
```
