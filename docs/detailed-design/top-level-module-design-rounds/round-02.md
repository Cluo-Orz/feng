# 顶层模块设计 Round 02

## 依据回看

CodeWhale 和 opencode 都把状态、事件、投影、工具执行和 UI/API 拆开。learn-claude-code 也说明核心 loop 应小，复杂度在 harness。第二轮引入底层基础设施。

## 草稿 v2

```text
Core Domain Contracts
File-Native Store
Event Ledger
Artifact Store
Input Admission
Grow State Machine
Message Compiler
Tool Runtime
LLM Gateway
Grow Runner
Evidence & Readiness
Hatch Builder
Feedback Router
Skill Registry
Agent Runtime Kernel
Target World Adapter
CLI
```

## 外部视角 Review

这个草稿工程化很多，但有新的风险：

```text
1. 太像 coding agent runtime。Tool Runtime、LLM Gateway、Runner 放在一起容易把 feng 拉回“另一个 Claude Code harness”。
2. Grow Kernel 与 Agent Runtime Kernel 的边界仍不够硬。hatch agent 的 runtime 不应该反向决定 feng 自身 grow 的模块形态。
3. Event Ledger 和 File Store 关系不清。事件是事实变化的时间线，文件是事实与 artifact 的载体，不能互相替代。
4. Policy 不应只属于 tool runtime。文件读取、反馈上报、hatch 发布、debug bridge 都需要 policy。
```

## 调整方向

第三轮要把系统拆成层：Foundation、Grow Kernel、Execution Harness、Hatch & Runtime、Interfaces。并将 Policy 作为横切但有独立模块。
