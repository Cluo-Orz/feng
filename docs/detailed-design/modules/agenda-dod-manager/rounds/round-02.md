# Agenda & DoD Manager Spec Round 02

## 当前草稿判断

第二版已经有 DoDItem、GapRecord 和 AttemptIntent，但还有越界风险：Agenda 可能开始判断“这个 DoD 已满足，所以 ready_to_hatch”。

这会抢走 Evidence & Readiness 的职责。

## 顶层视角检测

已完成模块给出的边界是：

```text
Admission 提供已准入输入、反馈候选、上游提议和证据引用。
Grow Unit Manager 维护 lifecycle，但不生成 DoD。
Artifact Registry 提供验证报告、trace、feedback evidence 等 artifact。
Evidence & Readiness 后续负责 DoD 满足状态、验证报告解释和 readiness verdict。
```

Agenda 的正确位置是定义“要证明什么”，不是判断“已经证明了什么”。

## 问题

第二版需要修正三点：

```text
DoDItem 不应有最终 satisfied 状态，只能链接 evidence expectation 或 latest evaluation ref。
AttemptIntent 不应绕过 Context Compiler 手写 message list。
Gap resolved 不等于 readiness passed。
```

另外，Agenda 应能触发 waiting_input/block 的建议，但不能直接改 grow lifecycle。

## 调整

第三版规定：

```text
DoDItem lifecycle 表达 proposed、active、retired、superseded、blocked。
DoD satisfaction 由 Evidence & Readiness 以 evaluation/ref/verdict 形式回写或引用。
AgendaSummary 可以建议 Grow Unit Manager 进入 waiting_input、waiting_feedback、planning、growing 或 verifying。
AttemptIntent 只提供目的和约束，Grow Attempt Runner 才执行，Context Compiler 才编译 message list。
```

## 进入下一轮的结论

下一轮需要让 Agenda 支撑长程任务：

```text
反复失败后如何形成最小缺口。
缺材料时如何停止编造。
DoD 如何随目标世界变化。
feedback 如何提出 agenda 候选但不直接改 active agenda。
```
