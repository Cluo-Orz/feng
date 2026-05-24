# 第 3 轮改进文档

## 1. 总体判断

前两轮补齐了关键架构缺口，当前设计已经能覆盖六个目标 agent 的主要生命周期。

第 3 轮的问题不是缺机制，而是：

```text
architecture.md 太像细节清单，不再足够像顶层架构文档。
```

这和用户早先要求冲突：

```text
架构设计一定要简单
文档不应过拟合
不要不断修修补补
要从顶层视角、系统性、结构性看
```

## 2. 不一致点

### 文档长度和定位不一致

当前 `architecture.md` 超过 600 行。

它包含很多正确但偏机制化的内容：

```text
manifest 字段
eval 形态
permission 状态
context 压缩顺序
tool 文件示例
state.yaml 示例
events.jsonl 示例
```

这些内容可以保留在未来机制规格中，但不应该让架构概念文档持续膨胀。

### 重复表达

多个章节重复表达：

```text
权限进入 manifest
config 保存本地事实
artifacts 保存运行证据
eval 是成长标准
release 是命名命令
```

重复会让读者觉得系统更复杂。

## 3. 建议修改

把 `architecture.md` 压缩回顶层架构文档。

保留：

```text
产品链路
两类用户
Kernel / Self Repo / .feng State / Git
Workspace 与 User Runtime 边界
Skill-first context engineering
Teach / Try / Release
Tool Growth
World
Context Budget
Release
MVP
```

压缩：

```text
具体 yaml 示例
过长状态枚举
manifest 字段细节
eval 类型细节
重复解释
```

原则：

```text
architecture.md 讲顶层结构。
core-requirements.md 讲核心诉求。
round-* 文档保留推演和改进历史。
未来具体格式另开 spec，不塞进架构概念文档。
```

## 4. 不建议新增的内容

本轮不应新增机制：

```text
不新增 marketplace
不新增复杂权限系统
不新增 eval 平台
不新增 tool 插件系统
不新增 session/resume
不新增领域 agent 专用设计
```

## 5. 本轮应修改的架构内容

重写 `docs/architecture.md`，保留现有设计结论，但压缩成更适合阅读和决策的概念文档。

目标不是减少能力，而是减少表达噪音。

