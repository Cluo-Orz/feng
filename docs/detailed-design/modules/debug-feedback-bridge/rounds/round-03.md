# Debug & Feedback Bridge Spec Round 03

## 当前草稿判断

第三版草稿的模块边界已经清楚，但还需要补强跨层传播的负面约束。

如果只写“可以上报”，读者会误解为所有下游材料都能进入上游。这正是本阶段要避免的思维误区。

## 顶层视角检测

用 `feng -> xiaoshuo -> libai-chongshengle` 检查：

```text
libai 项目产生的正文质量问题，默认属于 libai 项目或 xiaoshuo agent 的局部反馈。
只有抽象成 xiaoshuo 通用写作能力问题，才可能进入 xiaoshuo grow。
只有抽象成 feng 默认 feedback router、runtime kernel、contract、hatch 或 file-native 机制问题，才可能进入 feng grow。
```

因此跨层上报必须依赖：

```text
attribution。
redaction。
policyDecisionId。
evidenceRefs。
upstream proposal。
上游 Admission 重新判断。
```

## 问题

还需要补齐：

```text
DebugCorrelation 不是 session。
unknown attribution 不能上游。
原始 runtime_trace 默认不上游。
目标世界私有内容默认不上游。
非 LLM hatch 产物也可以通过 contract/debug signal 使用 Bridge。
```

## 调整

最终 spec 增加：

```text
多层闭环边界。
Default Feedback Router Protocol。
PrivacyFilterResult。
UpstreamProposalRequest。
明确错误 code 和验证要求。
```

最终不变量包括：

```text
FeedbackUnit 只能通过 Admission 创建。
UpstreamProposal 只能通过 Admission 创建。
Bridge 不修改 grow lifecycle、DoD、readiness、contract 或 package。
```

## 进入下一轮的结论

三轮检测后，该模块可以进入最终 spec。当前设计保留了多层自我演进能力，但没有把调试上报做成自动上游吸收。

