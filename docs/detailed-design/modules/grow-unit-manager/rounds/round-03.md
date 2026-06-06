# Grow Unit Manager Spec Round 03

## 当前草稿判断

第三版可以进入最终 spec，但必须明确“一个 grow 单元只有一个连续成长轨迹”。

这里不能引入用户可见 session，也不能引入 fork/session 列表。并发、attempt、wake、debug trace 都应该是 grow 单元下的事件和引用。

## 顶层视角检测

产品心智要求简单：

```text
用户提出智能行为目标。
feng 在一个 grow 单元中持续推进。
某次证据足够，系统说“成了”。
hatch 成目标世界可接入的能力包。
```

内部可以有多轮 attempt、多份 message list、多条 feedback、多次 readiness verdict，但用户面对的是同一个 grow 单元，而不是很多会话。

## 问题

最终 spec 需要防止三类漂移：

```text
把 attempt 当 session。
把 wake reason 当 session。
把 debug mode runtime trace 当 session。
```

它们都只是文件化事实的一部分。

长程恢复也要谨慎。Grow Unit Manager 可以提供可恢复状态 snapshot，但不能自己编译 prompt。下一轮 message list 仍由 Context & Message Compiler 从文件化事实生成。

## 调整

最终 spec 保留这些事实：

```text
GrowUnitRecord 是 grow 单元的当前投影视图。
GrowUnit lifecycle 由 grow_unit stream 事件重建。
同一 grow unit 下不存在用户可见 session 集合。
同一 grow unit 同时只允许一个 mutating coordination step 生效。
attempt、message list、feedback、readiness、hatch package 通过 Ref 关联。
状态变化必须有 causation/correlation 和来源。
```

## 进入下一轮的结论

本模块可以进入最终 spec。

最终 spec 必须保留这些硬约束：

```text
Grow Unit Manager 不调用 LLM。
Grow Unit Manager 不执行工具。
Grow Unit Manager 不编译 message list。
Grow Unit Manager 不判断 readiness。
Grow Unit Manager 不决定反馈采纳。
Grow Unit Manager 不构建 hatch package。
Grow Unit Manager 不暴露 Session。
```
