# Policy & Capability Boundary Spec Rounds

本文记录 `Policy & Capability Boundary` 模块 spec 的检测与调整过程。最终结论见：

```text
docs/detailed-design/modules/policy-capability-boundary/spec.md
```

## 输入文档

```text
docs/agent-research-notes.md
docs/agent-design-learning-summary.md
docs/feng-system-overview-design.md
docs/feng-kernel-and-long-running-design.md
docs/feng-novel-case-flow.md
docs/detailed-design/top-level-module-design.md
docs/detailed-design/modules/domain-model-contracts/spec.md
docs/detailed-design/modules/file-native-store/spec.md
docs/detailed-design/modules/event-ledger-projection/spec.md
docs/detailed-design/modules/artifact-registry/spec.md
```

## 轮次

```text
round-01.md
  将 policy 从“权限配置表”提升为可审计的 capability/action decision。

round-02.md
  补齐真实边界声明、隐私/发布/上报决策和调用方执行责任。

round-03.md
  收敛为最终模块边界：决策、约束、审计、approval/grant，不执行动作，不伪装成沙箱。
```

## 最终判断

`Policy & Capability Boundary` 是 feng 的动作边界决策层，不是强安全沙箱。它统一表达文件、命令、网络、外部服务、目标世界动作、artifact 读取/导出、反馈上报、hatch 发布、skill 启用和凭据访问的 policy decision，并把决策、约束、审批和真实执行边界写成可审计事实。
