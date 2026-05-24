# 架构推演方法

## 1. 目的

架构推演不能只验证动态关键路径，也不能只写“当前架构能解释某个 case”。

每轮推演必须回答：

```text
原始诉求的每个面是否被当前架构覆盖
每个目标 agent 在完整生命周期中如何落到这些面
哪里是架构概念已覆盖，哪里仍是实现期细节
是否出现为了单个 case 增加专用系统的过拟合风险
```

## 2. 输入

每轮至少读取：

```text
docs/core-requirements.md
docs/architecture.md
docs/agent-expectations/*
```

必要时读取上一轮：

```text
docs/architecture-review/round-XXX/inference-report.md
docs/architecture-review/round-XXX/improvement-notes.md
docs/architecture-review/round-XXX/review.md
```

## 3. 推演结构

推演报告必须以 case 为一级结构。

不允许只先写一个整体生命周期，再简单说“所有 case 都适用”。整体结论只能放在所有 case 推演之后。

每个 case 至少覆盖这些阶段：

```text
first grow / bootstrap
  第一次 grow 如何在普通目录中形成最小 self repo、world、interface、permissions、evals 和 Git 成长语义；这个阶段是否仍然只是 grow 的前置阶段，而不是独立产品命令。

grow
  长任务如何运行，agent 如何读取文件、调用 LLM、调用工具、修改 self。

message list
  system、user、assistant、tool response 如何进入稳定前缀或动态后缀。

tool growth
  初始工具是否足够，领域工具如何新增、验证和受权限约束。

context / cache
  大内容如何文件化，哪些内容进入 cache prefix，哪些进入 hot suffix。

git / repair
  candidate、validated commit、失败现场、修复和 tag 如何运转。

check
  schema、tool、permission、eval、启动验证如何判断。

hatch
  named command、manifest、config、permissions、portable package 如何产生。

execute
  使用者如何运行命令，使用者是否需要理解 feng。

observability
  running、progress、artifact 如何通过 .feng 文件和 CLI/GUI 观察。
```

## 4. 需求覆盖

推演报告必须在每个 case 内显式引用 `docs/core-requirements.md` 中的 `R01-R20`。

每个 case 的每个要求给出状态：

```text
满足
部分满足
未满足
实现期细节
```

如果是“部分满足”或“未满足”，必须说明：

```text
缺口是什么
是否需要修改架构文档
是否只是实现规格问题
是否有过拟合风险
```

允许在 case 内用紧凑矩阵表达，但不能只给全局矩阵。全局矩阵只能作为最后的汇总。

## 5. 退出条件

如果连续一轮详细推演只发现实现期细节，而没有架构概念缺口，就不应该继续扩写架构文档。

下一步应进入最小实现规格。
