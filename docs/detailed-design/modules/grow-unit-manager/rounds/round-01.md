# Grow Unit Manager Spec Round 01

## 当前草稿判断

第一版容易把 Grow Unit Manager 写成会话管理器：

```text
创建 session。
保存聊天历史。
恢复 session。
把下一轮 messages 接给 LLM。
```

这个方向必须拒绝。feng 明确没有用户需要理解的 session 概念。一个 grow 单元本身就是连续成长空间。

## 顶层视角检测

概要设计和长程任务补充给出的约束是：

```text
Grow 单元是 feng 的中心对象，不是聊天会话。
一个长程 grow 必须有稳定任务骨架，而不是只靠一串 messages。
状态可以恢复，目标不会丢，ready/hatch 不依赖模型自信。
下一轮 message list 应该由文件化事实编译出来。
```

调研结论也提醒：opencode 的 session 值得学习的是持久状态、事件、投影、权限和 context epoch，不是复制 session API 或 coding UI。

## 问题

会话管理器草稿有三个错误：

```text
把聊天历史当事实来源，破坏 file-native。
把 message list 当 grow unit 自身状态，破坏 Context Compiler 边界。
把用户心智带回“管理多个 session”，违背产品简化目标。
```

更隐蔽的问题是：如果 Grow Unit Manager 自己保存完整上下文和执行 loop，它会吞掉后续模块，变成 Grow Kernel 的所有东西。

## 调整

第二版改为 grow unit lifecycle 管理：

```text
GrowUnit 是一个智能行为的连续成长边界。
Grow Unit Manager 创建、打开、归档 grow unit。
它记录生命周期、目标边界摘要、当前阶段和关键引用。
它用事件表达状态变化。
它不保存聊天历史，不编译 message list，不调用 LLM。
```

attempt、wake、message list、trace 都是 grow 单元下的文件化事实或引用，不是用户可管理 session。

## 进入下一轮的结论

下一轮需要检查 Grow Unit Manager 是否仍然过度中心化，尤其是否侵入：

```text
Admission 的输入准入。
Agenda 的 DoD 和缺口。
Context Compiler 的 message list。
Evidence & Readiness 的 verdict。
Hatch Builder 的打包。
```
