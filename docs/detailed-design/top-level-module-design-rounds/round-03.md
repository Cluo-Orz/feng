# 顶层模块设计 Round 03

## 依据回看

`docs/feng-kernel-and-long-running-design.md` 明确了两个 kernel：Grow Kernel 与 Agent Runtime Kernel。Shinsekai 说明目标世界决定对外契约。AssistantAgent 说明外部能力要正规化成 contract。

## 草稿 v3

```text
Foundation Layer
  Core Domain Contracts
  File-Native Repository
  Event Ledger & Projection
  Artifact Registry
  Policy & Capability Boundary

Grow Kernel Layer
  Grow Unit Manager
  Input & Feedback Admission
  Agenda & DoD Manager
  Context / Message Compiler
  Evidence & Readiness

Execution Harness Layer
  LLM Gateway
  Tool Runtime
  Attempt Runner
  Background Job Coordinator

Hatch & Runtime Layer
  Hatch Builder
  Runtime Contract Registry
  Agent Runtime Kernel
  Target World Adapter
  Debug & Feedback Bridge

Interface Layer
  CLI
  Local Runtime API
```

## 外部视角 Review

这个版本接近 C2，但仍然偏“架构漂亮”。外部视角下还有问题：

```text
1. Background Job Coordinator 可能过早。第一阶段不一定需要 cron/background 独立模块，容易把 feng 做成任务平台。
2. Local Runtime API 也可能过早。当前用户要求 TypeScript 和设计文档，不代表第一阶段需要服务化 API。
3. Agenda & DoD Manager 和 Evidence & Readiness 是否拆开，要看职责是否稳定。前者管理目标与缺口，后者判断证据是否足够 hatch，拆开有意义。
4. Artifact Registry 和 File-Native Repository 是否拆开，要看 artifact 是否需要引用、预览、压缩、排除和发布边界。考虑 hatch 与 message list，大概率需要拆。
```

## 调整方向

第四轮要明确第一阶段核心模块和可选模块，不让 C2 设计把非核心 harness 变成产品中心。Local API 和 Background Jobs 可作为 extension slots，不放入最小核心链路。
