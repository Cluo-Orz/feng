# 顶层模块设计 Round 01

## 依据回看

系统概要已经给出核心对象：Grow 单元、事实层、编译层、执行层、Hatch 能力包、反馈单元。第一轮直接把这些对象映射为模块。

## 草稿 v1

```text
GrowUnit Module
FactLayer Module
MessageCompiler Module
GrowRuntime Module
EvidenceReadiness Module
HatchBuilder Module
FeedbackRouter Module
SkillSystem Module
TargetWorldAdapter Module
AgentRuntimeKernel Module
CLI Module
```

## 外部视角 Review

这个草稿太像概要设计的章节目录，不像可实现的 TypeScript 模块边界。问题有三个：

```text
1. 缺少 file-native 基础设施。事实层不是一个抽象名词，它需要存储、事件、artifact、索引和原子写入支撑。
2. 缺少输入准入。opencode 的 durable inbox 提醒我们：用户材料、反馈和调试上报不能直接进入模型可见上下文。
3. 缺少跨模块共享类型边界。TypeScript 项目需要先有核心 domain contracts，否则各模块会各自定义 GrowUnit、Feedback、Artifact，后续难以维护。
```

## 调整方向

第二轮需要先分出 foundation modules：Domain Contracts、File Store、Event Ledger、Policy、Artifact。再把 grow/hatch/runtime 放在它们之上。
