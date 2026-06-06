# Debug & Feedback Bridge Spec Round 02

## 当前草稿判断

第二版草稿已经避免了 trace 直写上游，但又出现另一个倾向：Bridge 可能变成一个“反馈大脑”。

如果 Bridge 同时负责路由、判断、采纳、升级、修改 DoD 和触发 grow，它就会吞掉 Admission、Agenda、Readiness、Skill 和 Grow Unit 的职责。

## 顶层视角检测

feng 需要多层闭环，但闭环不能靠一个中心化模块吞掉所有权。

更合理的拆法是：

```text
Runtime Contract 声明 debug/feedback 入口。
Agent Runtime Kernel 和 Target World Adapter 产生 trace、signal、hint。
Debug Bridge 归一化、归因、脱敏和提交候选。
Admission 管理 feedback 状态和 upstream proposal。
Agenda/DoD 决定是否把反馈转成下一轮 grow 缺口。
Evidence/Readiness 决定证据是否足够。
```

## 问题

Bridge 不能：

```text
修改 feedback status。
决定 accepted_local。
决定 accepted_upstream。
直接改 grow lifecycle。
直接创建 DoD。
直接让下游问题进入上游 message list。
执行任意 default_feedback_router skill body。
```

否则它会变成一个隐藏的 agent creator 和自动吸收器。

## 调整

把 default feedback router 降级为协议和 suggestion 来源：

```text
Bridge 读取 router descriptor、version、summary 和 compatibility。
router 输出进入 routerTraceRef。
router suggestion 只能影响 BridgePacket 的 suggestedAction。
状态转换仍交给 Admission。
是否进入下一轮 grow 仍交给 Agenda/DoD 和 Context Compiler。
```

补充边界：

```text
FeedbackBridgePacket 不等于 FeedbackUnit。
router suggestion 不等于 feedback status transition。
Bridge 不执行任意 skill body。
```

## 进入下一轮的结论

下一轮重点检查跨层隐私、非 LLM hatch 产物和 `feng -> xiaoshuo -> libai-chongshengle` 的数据流是否仍然成立。

