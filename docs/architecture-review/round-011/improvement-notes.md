# 第 11 轮改进文档

## 1. 总体判断

用户补充是正确的：

```text
推演必须根据每个 case 做推演，不是整体推演。
```

之前的 `review-method.md` 虽然写了“每个 case 至少覆盖这些阶段”，但没有明确禁止“整体推演代替 case 推演”。

## 2. 已修改内容

已修改：

```text
docs/architecture-review/review-method.md
```

新增约束：

```text
推演报告必须以 case 为一级结构。
不允许只先写一个整体生命周期，再简单说“所有 case 都适用”。
整体结论只能放在所有 case 推演之后。
R01-R20 必须在每个 case 内验收。
全局矩阵只能作为最后汇总。
```

## 3. 已重写第 11 轮推演

已将第 11 轮报告改为 case-first：

```text
Coding Agent
API Testing Agent
汇总新闻 Agent
小车 Agent
Windows 桌面助手 Agent
Claude Code 会话管理 Agent
Feng 自举
```

每个 case 都单独覆盖：

```text
new
grow
message list
tool growth
context / cache
git / repair
check
hatch
execute
observability
R01-R20
```

## 4. 是否修改 architecture.md

本轮不修改 `docs/architecture.md`。

原因：

```text
架构概念没有新缺口。
问题在推演方法。
把 case 推演塞进 architecture.md 会让概念文档变长。
```

## 5. 本轮结论

本轮修正的是推演粒度：

```text
从整体推演
改成 case-first 推演
```

这能避免过早抽象，也能更真实地检查原始诉求在不同目标 agent 上是否成立。
