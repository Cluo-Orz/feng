# 第 16 轮推演报告

## 1. 本轮目的

本轮是收敛检查，不主动寻找局部补丁。

检查对象：

```text
docs/core-requirements.md
docs/architecture.md
docs/mvp-self-iteration-design.md
```

检查标准：

```text
逻辑自洽
架构简单
概念一针见血
不为单个 case 过拟合
能解释普通 agent 和 feng 自举
```

## 2. 三文档链路

当前三文档形成如下链路：

```text
core-requirements
  定义产品本质：把想法孵化成可传播命令。

architecture
  定义承载方式：Runtime Kernel + Self Repo + .feng State + Git。

mvp-self-iteration-design
  定义第一版落地：用同一套机制让 feng 迭代 feng 自己。
```

这条链路现在没有明显断裂。

## 3. 全局概念检查

### 起点

当前起点是第一次 `grow`。bootstrap 是 grow 的前置阶段，不是产品命令。

状态：通过。

### 成长和执行

grow mode 修改 self repo，execute mode 运行 hatch 出来的 frozen self。

状态：通过。

### 文件即自我

self repo 表达 identity、goal、skills、hooks、tools、world、evals、interface、permissions、config schema。

状态：通过。

### Context Engineering

message list 围绕 token efficiency：稳定前缀、动态后缀、artifact refs、active tool pack。

状态：通过。

### Skill 和 Hook

skill 是能力契约；hook 是事件点。未来 hook 脚本必须作为 tool 受 permissions/check 约束。

状态：通过。

### Git 成长

Git 表达 candidate、validated commit、tag。LLM 修复 working tree，kernel 在验证通过后推进 commit/tag。

状态：通过。

### Hatch

hatch 输出命名命令。使用者运行 `xiaogui`，不是理解 feng。

状态：通过。

## 4. 七个 case 快速回放

```text
coding       通过。已有项目不会被 bootstrap 覆盖。
api testing  通过。world/config/permissions 能表达 spec、token、base URL。
news         通过。长正文文件化，summary 和来源进入 artifact refs。
car          通过。传感器和控制接口是 world/tool，安全由 permissions/evals 约束。
desktop      通过。dry-run、目录权限、PowerShell 输出都能进入同一模型。
ccmanage     通过。默认只读和 handoff 输出能由 interface/permissions 表达。
feng         通过。自举不需要专用初始化命令或另一个 agent，仍是 grow/check/hatch。
```

## 5. 结论

当前没有继续扩写架构概念的必要。

下一步应进入实现规格，而不是继续给架构文档加层：

```text
Self repo schema
Message compiler spec
Tool dispatcher spec
Permission checker spec
Check runner spec
Hatch package spec
```
