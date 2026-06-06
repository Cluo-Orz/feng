# Agent Runtime Kernel Spec Round 02

## 当前草稿判断

第二版草稿补齐了运行能力，但有把 Agent Runtime Kernel 写成第二个 Grow Kernel 的风险。

风险包括：

```text
运行中修订自己的目标。
运行中改写长期规则。
运行中吸收反馈。
运行中自动生成新版本。
让所有 hatch 产物都经过 Agent Runtime Kernel。
```

这些会让 feng 退化成 agent creator 或自修改运行时。

## 顶层视角检测

Agent Runtime Kernel 只在 hatch 产物需要 LLM agent 形态时使用。它不是 feng 的产品中心，也不是所有产物的默认形态。

non-LLM runtime、行为树、脚本模块、服务和混合 runtime 都可以绕过它，只要遵守 Runtime Contract。

## 问题

```text
如果运行时自动 grow，会绕过 Grow Kernel。
如果运行时直接改 package，会破坏可复现性。
如果所有产物都依赖它，会违背目标世界决定 runtime 形态。
```

## 调整

固定：

```text
Agent Runtime Kernel 只消费 hatch package 和 RuntimeContractRef。
生产模式下 package 和 contract 版本锁定。
运行日志不自动成为长期记忆。
反馈只成为候选，不直接采纳。
non_llm_runtime 不需要 Agent Runtime Kernel。
```

## 进入下一轮的结论

Agent Runtime Kernel 是可选运行底座，不是 Grow Kernel。下一轮要检查 memory、debug 和 target action 的污染风险。

