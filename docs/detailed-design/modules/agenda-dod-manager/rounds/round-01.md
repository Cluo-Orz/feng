# Agenda & DoD Manager Spec Round 01

## 当前草稿判断

第一版容易写成 Todo 工具：

```text
列任务。
标记完成。
记录下一步。
把计划放进 prompt。
```

这个方向不够。TodoWrite 是计划工具，不是成长证据。feng 需要的是目标、缺口、DoD、验证意图和下一轮 attempt 为什么存在。

## 顶层视角检测

长程任务设计要求：

```text
目标契约：当前 grow 到底要成为什么。
DoD：什么证据能说明它足够 hatch。
议程：下一步要推进的缺口、候选和验证点。
阻塞状态：缺什么材料、权限、确认或验证环境。
```

顶层模块设计也明确：Agenda & DoD Manager 不判断最终 readiness，Evidence & Readiness 才负责基于证据给出 verdict。

## 问题

Todo 草稿的问题是：

```text
计划完成不等于能力成熟。
自然语言目标不等于可验证 DoD。
下一步建议不等于 attempt 执行。
用户反馈不应自动改写 DoD。
```

如果 Agenda 只是待办列表，feng 会继续“看起来在推进”，但无法解释为什么某一天可以 hatch。

## 调整

第二版改为：

```text
AgendaItem 表达当前要推进的缺口或验证点。
GapRecord 表达缺材料、缺权限、缺验证环境、契约不完整、证据不足等阻塞。
DoDItem 表达完成条件和需要的证据类型。
AttemptIntent 表达下一轮 attempt 的目的、输入约束、期望输出和证据目标。
```

Agenda 管理定义和意图，不管理证据 verdict。

## 进入下一轮的结论

下一轮需要检查：

```text
DoD 和 Evidence 是否分清。
Agenda 和 Grow Unit lifecycle 是否分清。
Agenda 和 Context Compiler 是否分清。
Agenda 是否能处理 feedback/admission 触发的候选变更，但不自动采纳。
```
