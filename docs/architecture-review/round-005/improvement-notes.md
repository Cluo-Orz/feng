# 第 5 轮改进文档

## 1. 总体判断

当前架构不需要新增大模块，但需要补三个顶层边界：

```text
产品命名层
Message List 组装层
Feng 同名自举 case
```

## 2. 改进一：命名层

### 问题

`teach / try / release` 功能清晰，但不够 feng。

它们更像传统 agent 框架命令，不像“孵化一个生命体”的产品语言。

### 建议

把公开主路径改成：

```text
feng new xiaogui
feng grow "帮我整理下载目录"
feng check
feng hatch --name xiaogui --portable
```

语义：

```text
grow
  推动 self 成长，吸收规则、示例、反馈。

check
  检查 candidate 是否可以成为下一版 self。

hatch
  把 validated self 破壳成命名命令。
```

`teach / try / release` 可以作为内部语义或兼容别名，但架构文档的产品路径应使用 `grow / check / hatch`。

## 3. 改进二：Message List 编排

### 问题

当前文档只说 assemble context，没有定义最终 messages list。

### 建议

增加 “Message List” 小节，保持简单。

每轮 message list 按稳定顺序生成：

```text
1. kernel message
2. self message
3. event message
4. selected context messages
5. working state message
6. history summary message
7. output contract message
```

tool result 不单独成为长期层，而是作为 event message 或 working state 的证据进入下一轮。

每个 message 带来源和预算信息：

```text
source
layer
priority
budget
hash
```

这不是让用户维护 prompt block，而是 kernel 内部为了缓存、压缩、追踪和 adapter 转换而保留的 message assembly 规则。

## 4. 改进三：Feng 同名自举 case

### 问题

新增自举 case 说明，feng 应该能用自己的机制迭代自己。

### 建议

在架构文档中补充：

```text
feng hatch --name feng --portable 是自举验证 case。
```

它不是一个新的命令或新的 agent。它不获得特殊架构能力，仍然通过：

```text
self repo
.feng state
Git
skills
tools
evals
permissions
```

来审查、修改、验证、提交并 hatch feng 自己。

如果自举需要特殊通道，说明架构不够自洽。

## 5. 不建议修改

不建议做：

```text
复杂命令别名系统
prompt DSL
独立 message 编排语言
自举专用 runtime
新的自举专用命令
```

本轮只补顶层语义和 message assembly 规则。
