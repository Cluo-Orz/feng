# 第 9 轮改进文档

## 1. 总体判断

用户指出的问题成立：

```text
之前推演结果太简单。
推演只覆盖了动态关键节点。
没有逐项检查原始诉求是否满足。
```

这不是 `docs/architecture.md` 的核心逻辑错误，而是 review 方法不够严格。

## 2. 改进一：原始诉求需要编号

### 问题

没有统一的需求编号，导致推演只能泛泛地说“满足核心诉求”。

### 修改

已在 `docs/core-requirements.md` 新增：

```text
## 17. 原始诉求验收面
```

并整理出：

```text
R01-R20
```

覆盖 LLM、function call、自造工具、token efficiency、协议、message 编排、skill、GUI/CLI、初始工具、白板孵化、文件即自我、Git、repair、world、长任务、可观测、hatch、权限、自举、简单不过拟合。

## 3. 改进二：推演需要固定方法

### 问题

没有推演方法约束，报告容易只写关键路径。

### 修改

新增：

```text
docs/architecture-review/review-method.md
```

要求每轮至少覆盖：

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
```

并显式引用 `R01-R20`。

## 4. 是否需要修改架构文档

本轮不修改 `docs/architecture.md`。

原因：

```text
架构文档已经覆盖核心概念。
问题是推演和验收方法不够细。
把完整验收矩阵塞进 architecture.md 会让概念文档变长。
```

更合适的边界是：

```text
core-requirements.md
  记录原始诉求验收面。

architecture.md
  保持短架构概念。

architecture-review/review-method.md
  约束每轮如何推演。
```

## 5. 仍然保留的实现期细节

这些问题不进入架构概念文档：

```text
Message 数据结构字段
ToolResult 截断算法
ArtifactRef 文件命名
active tool pack selection 算法
provider adapter 的具体 JSON 映射
Git helper 的具体命令
GUI 的页面布局
portable package 的具体格式
```

它们应进入最小实现规格。

## 6. 本轮结论

本轮修正了“推演过浅”的工作方法问题。

下一轮应使用新的 `R01-R20 + lifecycle stage` 方法重新审查当前架构，确认是否还存在遗漏。
