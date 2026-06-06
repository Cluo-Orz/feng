# Domain Model & Contracts Spec Round 02

## 当前草稿判断

第二轮草稿把模块定位为 TypeScript 领域语言层：

```text
branded ids。
refs。
lifecycle states。
result/error。
source/version/audit metadata。
module ports 的输入输出基类型。
```

## 顶层视角检测

这个方向符合顶层设计，但仍有两个风险：

```text
1. 类型层可能被写得过于抽象，后续模块无法判断自己应该依赖什么。
2. 类型层可能过度中心化，把每个模块私有类型也放进来，导致 Domain Model 变成巨型垃圾桶。
```

从 learn-claude-code 和 AssistantAgent 的经验看，工具、skill、memory、runtime 都需要各自局部类型。共享类型应该只包含跨模块边界稳定的概念。

## 问题

需要划清三类类型：

```text
Global domain type：所有模块都要理解，如 GrowUnitId、ArtifactRef。
Cross-module contract type：两个以上模块共享，如 ReadinessVerdict、PolicyDecision。
Module-private type：只在模块内部使用，不进入 Domain Model & Contracts。
```

否则后续模块会把自己的实现细节提前塞进全局类型。

## 调整

Domain Model & Contracts 应定义以下终态事实：

```text
所有 id 使用 branded string，禁止裸 string 混用。
所有跨模块引用使用 Ref，而不是直接携带大型对象。
所有状态使用闭合 union 或 enum，并有 Unknown/Unsupported 的版本兼容策略。
所有跨模块操作返回 Result，而不是抛出任意异常作为业务结果。
所有外部输入都携带 SourceDescriptor。
所有可持久化事实都携带 schemaVersion 或 contractVersion 概念。
```

## 进入下一轮的结论

Round 03 需要把最终 spec 写成“该模块导出哪些语言能力”和“它不允许承担哪些业务职责”，并检查是否与 File-Native Store、Event Ledger、Artifact Registry 的后续职责冲突。
