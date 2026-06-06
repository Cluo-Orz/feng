# 顶层模块设计 Round 04

## 依据回看

产品概念强调表面简单：用户提出智能行为，持续给材料和反馈，直到 feng 说“成了”。调研总结强调复杂度不可消失，只能放在可审计位置。第四轮聚焦最小可信闭环。

## 草稿 v4

```text
核心基础模块
  Domain Model & Contracts
  File-Native Store
  Event Ledger & Projection
  Artifact Registry
  Policy & Capability Boundary

Grow 核心模块
  Grow Unit Manager
  Admission & Feedback Inbox
  Agenda / DoD Manager
  Context & Message Compiler
  Grow Attempt Runner
  Evidence & Readiness

能力面模块
  Skill Registry
  Tool Runtime
  LLM Gateway

Hatch 与运行模块
  Hatch Builder
  Runtime Contract Registry
  Agent Runtime Kernel
  Target World Adapter
  Debug & Feedback Bridge

用户入口
  CLI
```

## 外部视角 Review

这个版本更收敛，但仍需要补足四个产品维度的详细设计：

```text
1. 数据归属：哪些模块写 grow 事实，哪些只写 attempt trace，哪些写 hatch 包，哪些写 runtime trace。
2. 依赖方向：CLI 不能绕过 Grow Unit Manager 直接改文件；Agent Runtime Kernel 不能绕过 Feedback Router 直接改 grow。
3. TypeScript 边界：每个模块要暴露 typed port，而不是共享可变对象。
4. 后续模块 spec 顺序：越底层越先设计，越晚的模块依赖更多上下文。
```

## 调整方向

第五轮把模块确定为最终 C2 边界，并补齐依赖方向、数据所有权、关键流和 spec 顺序。
