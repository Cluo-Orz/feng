# 第 17 轮改进文档

## 1. 预置 skill 违反白板起点

问题：

```text
MVP 文档写了“至少四个 skill”。
这些 skill 虽然看似通用，但实际围绕 feng 文档自举。
```

这会导致：

```text
feng 安装后不是白板
默认模板变成隐藏能力包
自举依赖预制能力
其他项目会被错误套用同一组 skill
```

## 2. 改进

修改主文档：

```text
默认 bootstrap 只创建 self repo 最小形状。
skills/ 可以为空。
第一个 grow 通过通用 seed loop 生成 candidate skills/world/evals/interface。
默认模板不预置领域 skill。
local template 可以带 skill，但必须是创造者显式选择。
```

修改 MVP 文档：

```text
删除预置 read-requirements / case-first-review / edit-self / repair-candidate。
删除预置 feng project world。
删除预置 case-first review eval。
hooks.yaml 初始为空。
无匹配 skill 时进入通用 seed loop。
```

## 3. 为什么不是弱化 MVP

MVP 的目标不是证明 feng 一开始就会 review 架构。

MVP 的目标是证明：

```text
没有预置项目能力时，feng 仍能通过通用 loop 感知当前仓库、生成 candidate self、check、repair、hatch。
```

这更贴近原始诉求。

## 4. 不新增系统

本轮没有新增新的 bootstrap 系统。

通用 seed loop 仍使用现有核心对象：

```text
Runtime Kernel
Self Repo
.feng State
Git
初始四工具
```
