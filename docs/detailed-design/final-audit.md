# 详细设计完成审计

本文是 feng TypeScript 详细设计阶段的完成审计。

## 审计结论

```text
顶层模块设计已完成。
20 个模块 spec 已完成。
每个模块都有 spec.md。
每个模块都有 rounds/index.md。
每个模块都有至少 3 个 round 文档。
多轮过程已拆分到 docs/detailed-design 下的目录和独立文件中维护。
模块 spec 以 SDD 风格描述终态事实，而不是实现计划。
```

## 自动检查结果

已检查模块目录：

```text
domain-model-contracts
file-native-store
event-ledger-projection
artifact-registry
policy-capability-boundary
skill-registry
grow-unit-manager
admission-feedback-inbox
agenda-dod-manager
context-message-compiler
llm-gateway
tool-runtime
grow-attempt-runner
evidence-readiness
runtime-contract-registry
hatch-builder
target-world-adapter
agent-runtime-kernel
debug-feedback-bridge
cli
```

检查结果：

```text
模块目录数：20
缺失 spec.md：0
缺失 rounds/index.md：0
round-*.md 少于 3 个的模块：0
模块 spec 中发现 TODO/后续需要实现/计划支持/可能考虑：0
```

## 已完成文档

根文档：

```text
docs/detailed-design/README.md
docs/detailed-design/module-spec-process.md
docs/detailed-design/top-level-module-design.md
docs/detailed-design/progress-audit.md
docs/detailed-design/final-audit.md
```

顶层设计轮次：

```text
docs/detailed-design/top-level-module-design-rounds/index.md
docs/detailed-design/top-level-module-design-rounds/round-01.md
docs/detailed-design/top-level-module-design-rounds/round-02.md
docs/detailed-design/top-level-module-design-rounds/round-03.md
docs/detailed-design/top-level-module-design-rounds/round-04.md
docs/detailed-design/top-level-module-design-rounds/round-05.md
```

模块文档：

```text
docs/detailed-design/modules/<module-name>/spec.md
docs/detailed-design/modules/<module-name>/rounds/index.md
docs/detailed-design/modules/<module-name>/rounds/round-01.md
docs/detailed-design/modules/<module-name>/rounds/round-02.md
docs/detailed-design/modules/<module-name>/rounds/round-03.md
```

## 核心约束覆盖

本轮详细设计已经覆盖以下约束：

```text
feng 使用 TypeScript 作为实现前提。
feng 是 file-native 系统。
feng 没有用户需要理解的 session 概念。
一个 grow unit 是一个连续成长空间。
下一轮 grow LLM loop 的 message list 是 file-native artifact。
grow compiled_message_list 只能由 Context & Message Compiler 创建。
runtime_message_list 只能由 Agent Runtime Kernel 创建。
artifact registration 不等于业务采纳。
用户输入必须先进入 Admission & Feedback Inbox。
readiness 由 Evidence & Readiness 基于证据和 DoD 给出。
ready_to_hatch 不等于 hatch package。
hatch_package 只能由 Hatch Builder 创建。
hatch 不能复制 grow 目录。
hatch 输出不一定是 LLM agent。
如果 hatch 输出是 agent，必须有 Agent Runtime Kernel 级别的运行底座，不只是 prompt wrapper。
目标世界决定 runtime 形态。
non_llm_runtime 不强制进入 Agent Runtime Kernel。
runtime feedback 不能绕过 Debug & Feedback Bridge 和 Admission。
FeedbackUnit 只能通过 Admission & Feedback Inbox 创建。
UpstreamProposal 只能通过 Admission & Feedback Inbox 创建。
Policy allow 不等于动作已经执行。
CLI 不拥有业务状态，不直接写 grow 文件，不绕过 Policy。
```

## 已覆盖的关键链路

Grow 链路：

```text
CLI / user input
-> Admission & Feedback Inbox
-> Agenda & DoD Manager
-> Context & Message Compiler
-> Grow Attempt Runner
-> LLM Gateway / Tool Runtime
-> Artifact Registry / Event Ledger
-> Evidence & Readiness
-> Grow Unit Manager lifecycle coordination
```

Hatch 链路：

```text
Evidence & Readiness ready_to_hatch
-> Runtime Contract Registry locked contract
-> Hatch Builder build plan
-> Hatch Builder hatch_package
-> Grow Unit Manager link package
```

Runtime / feedback 链路：

```text
Hatch package
-> Target World Adapter
-> Agent Runtime Kernel when agent runtime is applicable
-> RuntimeTrace / TargetDebugSignal / RuntimeFeedbackCandidateHint
-> Debug & Feedback Bridge
-> Admission & Feedback Inbox feedback candidate
-> local adoption or upstream proposal
```

## 未做事项

以下事项是本阶段刻意未做，不属于遗漏：

```text
没有定义最终目录 schema。
没有定义完整 JSON/YAML schema。
没有编写 TypeScript 代码。
没有生成完整 CLI 手册。
没有设计具体 provider adapter、MCP adapter 或 target world host adapter。
没有设计 UI。
没有设计安装、分发、自动更新。
没有实现 eval runner。
没有把所有 hatch 产物强行收敛为聊天 agent。
```

## 剩余开放问题

开放问题已经分散记录在各模块 spec 的“开放问题”小节中。它们主要集中在：

```text
具体文件布局和 schema。
provider-neutral message 结构细节。
policy 配置文件和 redaction 细节。
第一阶段 proof slice 的场景取舍。
target world host integration。
CLI 具体命令名、flag 和帮助文本。
后台 worker、watch mode、安装和分发。
```

这些问题不影响当前详细设计的完成状态。它们属于实现阶段或更细场景设计的入口。

## 风险判断

当前设计最重要的风险不是模块数量，而是实现阶段可能把边界抹平：

```text
把 CLI 写成业务中枢。
把 grow attempt 写成隐藏 session。
把 admitted material 直接拼进 prompt。
把 model self claim 当 readiness。
把 hatch package 做成 grow 目录复制。
把 debug trace 直接吸收到上游。
把 non-LLM runtime 强制套进 agent loop。
```

这些风险已经在模块不变量和验证要求中被显式约束。后续实现阶段应优先用接口边界、测试和文档示例防止这些退化。

