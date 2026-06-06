# Agent Runtime Kernel Spec Round 03

## 当前草稿判断

第三版草稿要检查三个运行期风险：

```text
运行日志自动变长期记忆。
debug feedback 直接写上游 grow。
target action 绕过 adapter 或 policy。
```

## 顶层视角检测

hatch agent 要能参与后续 grow，但不能自己绕过 grow。运行期产生的是 trace、debug signal 和 feedback candidate hint。

是否采纳、是否上游、是否生成新版本，仍然由 Admission、Evidence、Grow Kernel 和 Hatch Builder 处理。

## 问题

```text
长期记忆自动写入会污染能力。
debug 模式可能泄露目标世界私有状态。
模型输出动作如果直接执行，会绕过 Runtime Contract 和 Policy。
```

## 调整

固定：

```text
RuntimeMessageList 是 artifact。
RuntimeTrace 是 artifact。
LongTermMemoryRead 只读取已采纳资源。
RuntimeFeedbackCandidateHint 不等于 FeedbackUnit。
target action 必须经过 Target World Adapter 和 Policy。
生产模式不允许 runtime 修改 package、contract 或核心 prompt。
```

## 进入下一轮的结论

Agent Runtime Kernel spec 可以收敛。它是 hatch agent 的高质量运行底座，提供文件化上下文、LLM/action loop、trace 和反馈候选边界，但不负责 grow、自我升级或上游吸收。

