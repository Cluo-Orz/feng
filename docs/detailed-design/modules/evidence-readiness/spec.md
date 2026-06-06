# Evidence & Readiness Spec

本文是 `Evidence & Readiness` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Evidence & Readiness` 是 feng 的证据登记、证据解释、DoD evaluation 和 readiness verdict 层。

它回答的问题是：在当前 grow 目标、DoD、边界和已观察事实下，是否继续 grow、等待输入、等待反馈、等待验证、阻塞，或已经足够进入 hatch。

它不依赖模型自信，不执行验证环境，不构建 hatch package，也不直接修改 grow lifecycle。

## 职责

该模块负责：

```text
登记 evidence candidate。
管理 EvidenceRecord。
分类证据类型、来源、作用范围、隐私和新鲜度。
判断证据与 DoD 的关系。
记录 supporting、contradicting、inconclusive 和 missing evidence。
解释 validation_report、attempt_trace、tool_result、runtime_trace、feedback_evidence 和 manual_review。
生成 DoDEvaluation。
生成 ReadinessAssessment。
生成 ReadinessVerdict。
记录 readiness gap。
注册 readiness report 或 validation_report 派生产物。
提供 EvidenceSummary 和 ReadinessSummary。
解释一个 verdict 的证据链和缺口。
记录 evidence、DoD evaluation 和 readiness 事件。
```

该模块不负责：

```text
定义或修订 DoD。
创建 AttemptIntent。
执行 grow attempt。
调用 LLM。
执行工具。
运行目标世界模拟器。
生成 runtime trace。
接收原始用户输入。
采纳 feedback。
修改 grow lifecycle。
构建 hatch package。
发布 hatch package。
保存大型 artifact 内容。
提供 eval runner。
提供目标世界 adapter。
```

## 依赖关系

```text
Depends on:
  Domain Model & Contracts
  File-Native Store
  Event Ledger & Projection
  Artifact Registry
  Policy & Capability Boundary
  Grow Unit Manager
  Admission & Feedback Inbox
  Agenda & DoD Manager
  Grow Attempt Runner

Used by:
  Grow Unit Manager
  Agenda & DoD Manager
  Context & Message Compiler
  Runtime Contract Registry
  Hatch Builder
  Target World Adapter
  Agent Runtime Kernel
  Debug & Feedback Bridge
  CLI
```

事实：

```text
Evidence & Readiness 读取 GrowUnitStateSnapshot、AdmissionSummary、AgendaSummary、DoDItem、AttemptOutcomeSummary 和 Artifact metadata。
Evidence & Readiness 通过 Artifact Registry materialize 受控证据内容、preview 或 summary。
Evidence & Readiness 通过 Policy 判断证据读取、敏感证据传播和 hatch readiness 报告可见性。
Evidence & Readiness 通过 Event Ledger 写入 evidence/readiness 事件。
Evidence & Readiness 不直接调用 LLM Gateway 或 Tool Runtime。
Evidence & Readiness 不直接改 Grow Unit lifecycle。
```

## Evidence Record

EvidenceRecord 是可用于评估的证据事实。

EvidenceRecord 至少表达：

```text
evidenceId
evidenceRef
growUnitRef
sourceKind
sourceRef
artifactRef
summary
scope
status
quality
relationHints
privacyClass
freshness
version
createdAt
source
audit
```

sourceKind 至少包括：

```text
attempt_outcome
candidate_output
tool_result
validation_report
attempt_trace
runtime_trace
feedback_evidence
manual_review
policy_decision
artifact_metadata
external_test_report
llm_judge_report
unknown
```

status 至少包括：

```text
candidate
accepted_for_evaluation
rejected
waiting_policy
waiting_human
waiting_validation
stale
superseded
redacted
unavailable
```

事实：

```text
Evidence candidate 不等于 accepted_for_evaluation。
artifact registration 不等于 evidence accepted。
feedback candidate 必须先经过 Admission 才能成为 evidence candidate。
llm_judge_report 不能单独支撑 ready_to_hatch。
unavailable、redacted 或 privacy unknown 的证据不能支撑发布级 readiness。
```

## Evidence Quality

EvidenceQuality 表达证据可信度和适用边界。

它至少包含：

```text
observationKind
trustLevel
reproducibility
freshnessStatus
scopeFit
privacyFit
contradictionRisk
explanation
```

observationKind 至少包括：

```text
observed_runtime
tool_measured
test_reported
manual_reviewed
model_self_claim
model_judged
derived_summary
unknown
```

trustLevel 至少包括：

```text
strong
moderate
weak
unsupported
blocked
```

事实：

```text
model_self_claim 默认是 weak。
model_self_claim 不能单独通过 DoD。
manual_reviewed 必须有 reviewer/source/scope。
tool_measured 必须能追溯到 tool_result 或 validation_report。
observed_runtime 必须能追溯到 runtime_trace 或 external_test_report。
```

## Evidence Relation

EvidenceRelation 表达证据和 DoD、gap、candidate output 的关系。

relation 至少包括：

```text
supports
contradicts
inconclusive
out_of_scope
stale_for_scope
blocked_by_policy
missing_required_evidence
```

事实：

```text
证据关系是 evaluation 事实，不修改原始证据。
同一 evidence 可以支持一个 DoD，同时反驳另一个 DoD。
contradicting evidence 必须进入 readiness 解释，不能被静默忽略。
```

## DoD Evaluation

DoDEvaluation 表达某个 DoDItem 当前是否被证据满足。

它至少包含：

```text
dodEvaluationId
dodRef
growUnitRef
status
supportingEvidenceRefs
contradictingEvidenceRefs
missingEvidence
blockedReasons
evaluationScope
evidenceQualitySummary
explanation
createdAt
source
audit
```

status 至少包括：

```text
passed
failed
unknown
blocked
needs_input
needs_validation
stale
not_applicable
```

事实：

```text
DoDEvaluation 评价 DoD，不修改 DoD。
passed 不表示 grow ready_to_hatch，必须汇总成 ReadinessVerdict。
failed 不直接改 Agenda。
unknown 和 needs_validation 是有效结果，不允许被静默当作 passed。
active DoD 缺失时，ReadinessVerdict 不能是 ready_to_hatch。
```

## Readiness Assessment

ReadinessAssessment 汇总一组 DoD evaluation、证据和缺口。

它至少包含：

```text
readinessAssessmentId
growUnitRef
agendaSummaryRef
activeDoDRefs
dodEvaluationRefs
evidenceRefs
attemptOutcomeRefs
validationReportRefs
feedbackEvidenceRefs
readinessGapRefs
riskSummary
privacySummary
policyDecisionRefs
createdAt
source
audit
```

事实：

```text
Assessment 是中间评估事实，不是 lifecycle transition。
Assessment 必须能解释每个 active DoD 的状态。
Assessment 必须包含 supporting 和 contradicting 证据摘要。
```

## Readiness Verdict

ReadinessVerdict 是该模块的核心输出。

它至少包含：

```text
readinessVerdictId
readinessVerdictRef
growUnitRef
assessmentRef
verdict
reason
dodEvaluationRefs
requiredInput
requiredFeedback
requiredValidation
blockingGaps
evidenceRefs
policyDecisionRefs
recommendedGrowLifecycle
createdAt
source
audit
```

verdict 至少包括：

```text
ready_to_hatch
continue_grow
waiting_input
waiting_feedback
waiting_validation
blocked
not_ready
inconclusive
```

事实：

```text
ReadinessVerdict 不直接修改 grow lifecycle。
Grow Unit Manager 应用 verdict 后才能改变 lifecycle。
ready_to_hatch 只表示当前证据足够进入 hatch builder，不表示 hatch package 已构建。
continue_grow 不指定下一轮具体策略。
waiting_input 必须包含最小 requiredInput。
waiting_validation 必须说明缺少哪类验证。
blocked 必须说明阻塞原因和可恢复条件。
```

## Ready To Hatch Gate

`ready_to_hatch` verdict 必须满足以下事实：

```text
存在 active DoD。
所有必须通过的 active DoD 均有 passed evaluation。
不存在未解释的 critical contradicting evidence。
不存在 blocking readiness gap。
关键 candidate output、validation report、attempt trace 或 feedback evidence 可读。
证据 privacy 和 policy 边界允许进入 hatch 判断。
目标世界或运行契约相关 DoD 没有 unknown/needs_validation 状态。
```

事实：

```text
模型声称完成不能单独触发 ready_to_hatch。
attempt completed 不能单独触发 ready_to_hatch。
tool succeeded 不能单独触发 ready_to_hatch。
manual approval 可以作为证据，但必须有 scope、source 和 audit。
ready_to_hatch 仍可能被 Hatch Builder 的发布边界或包构建检查阻断。
```

## Readiness Gap

ReadinessGap 表达阻止 readiness 的证据缺口。

它至少包含：

```text
readinessGapId
growUnitRef
kind
summary
relatedDoDRefs
relatedEvidenceRefs
requiredInput
requiredValidation
requiredFeedback
blocking
source
audit
```

kind 至少包括：

```text
missing_evidence
contradicting_evidence
stale_evidence
artifact_unavailable
privacy_blocked
policy_blocked
validation_environment_missing
target_world_unverified
runtime_contract_unverified
manual_review_required
feedback_required
```

事实：

```text
ReadinessGap 不等于 Agenda Gap。
ReadinessGap 可以被 Agenda 后续吸收为 GapRecord 候选。
ReadinessGap 必须说明最小缺口，不推动模型继续编造。
```

## Reports and Artifacts

Evidence & Readiness 可以注册派生 artifact。

artifact kind 至少包括：

```text
validation_report
feedback_evidence
summary
```

事实：

```text
Readiness report 是派生 summary，不替代 Event Ledger 事件。
validation_report artifact 可以来自外部验证，也可以是对验证结果的派生解释。
本模块不创建 hatch_package artifact。
本模块不创建 compiled_message_list artifact。
```

## Ports

### Evidence Port

```text
recordEvidenceCandidate(input) -> Result<EvidenceRef>
classifyEvidence(evidenceRef, context) -> Result<EvidenceClassification>
acceptEvidenceForEvaluation(evidenceRef, reason) -> Result<EvidenceReceipt>
rejectEvidence(evidenceRef, reason) -> Result<EvidenceReceipt>
markEvidenceStale(evidenceRef, reason) -> Result<EvidenceReceipt>
listEvidence(growUnitRef, query) -> Result<EvidencePage>
```

事实：

```text
recordEvidenceCandidate 不表示证据可用于 evaluation。
acceptEvidenceForEvaluation 必须检查 artifact lifecycle、privacy 和 scope。
rejectEvidence 不删除原始 artifact。
markEvidenceStale 不改写历史 evaluation。
```

### Evaluation Port

```text
evaluateDoD(dodRef, evidenceRefs, context) -> Result<DoDEvaluation>
evaluateActiveDoD(growUnitRef, options) -> Result<DoDEvaluationSet>
explainDoDEvaluation(evaluationRef) -> Result<DoDEvaluationExplanation>
```

事实：

```text
evaluateDoD 不修改 DoD。
evaluateActiveDoD 不修改 grow lifecycle。
每个 evaluation 都必须列出 supporting、contradicting 和 missing evidence。
```

### Readiness Port

```text
assessReadiness(growUnitRef, options) -> Result<ReadinessAssessment>
produceReadinessVerdict(assessmentRef) -> Result<ReadinessVerdict>
explainReadinessVerdict(verdictRef) -> Result<ReadinessExplanation>
```

事实：

```text
assessReadiness 不构建 hatch package。
produceReadinessVerdict 写入 readiness 事件。
explainReadinessVerdict 返回证据链、DoD 状态、缺口和推荐 lifecycle。
```

### Summary Port

```text
buildEvidenceSummary(growUnitRef, options) -> Result<EvidenceSummary>
buildReadinessSummary(growUnitRef, options) -> Result<ReadinessSummary>
```

事实：

```text
summary 可被 Context Compiler、Grow Unit Manager、Agenda、Hatch Builder 和 CLI 使用。
summary 不包含被 policy 阻断的原文。
```

## 事件

该模块写入 evidence/readiness 相关事件。事件可落在 grow_unit stream 下，或由 Event Ledger 在实现阶段提供 evidence stream。

事件类型至少包括：

```text
evidence_candidate_recorded
evidence_classified
evidence_accepted_for_evaluation
evidence_rejected
evidence_marked_stale
evidence_redacted
dod_evaluation_created
readiness_assessment_created
readiness_gap_recorded
readiness_verdict_recorded
readiness_verdict_superseded
readiness_report_registered
```

事实：

```text
事件 payload 保存 summary、Ref、status 和 verdict，不内联大型证据内容。
纠错通过 superseding event，不改写旧事件。
DoD evaluation 和 readiness verdict 可由事件与 artifact 重建解释。
```

## 与其他模块的边界

### Agenda & DoD Manager

Agenda 定义 DoD、Gap 和 AttemptIntent。

Evidence & Readiness 评价 DoD 并产出 evaluationRef。

事实：

```text
Evidence 不创建 DoD。
Evidence 不修改 Agenda。
DoDEvaluation 可以被 Agenda 链接为 latestEvaluationRef。
ReadinessGap 可以成为 Agenda GapRecord 候选，但不自动写入 Agenda。
```

### Grow Attempt Runner

Attempt Runner 产出 AttemptOutcomeSummary、candidateOutputRefs、toolSettlementRefs 和 attemptTraceRef。

Evidence & Readiness 将这些事实作为 evidence candidate 来源。

事实：

```text
attempt completed 不等于 readiness passed。
candidate output 不等于 accepted evidence。
attempt trace 可证明过程，但不自动证明结果正确。
```

### Admission & Feedback Inbox

Admission 管理 feedback status 和准入。

Evidence & Readiness 使用已准入或已关联的 feedback_evidence。

事实：

```text
feedback candidate 不自动成为 evidence accepted。
Evidence 不改变 feedback status。
隐私不明的 feedback evidence 不能支撑上游 readiness。
```

### Artifact Registry

Artifact Registry 保存 validation_report、feedback_evidence、attempt_trace、runtime_trace、tool_result 和 candidate_output。

Evidence & Readiness 读取 metadata、preview、summary 或受控内容。

事实：

```text
artifact registration 不等于 evidence accepted。
retracted artifact 不能支撑新 readiness verdict。
redacted/unavailable artifact 必须显式影响 evaluation。
```

### Policy & Capability Boundary

Policy 判断证据读取、敏感内容传播和 readiness report 可见性。

Evidence & Readiness 记录 policyDecisionId。

事实：

```text
Policy allow 不等于证据有效。
Policy deny 不删除证据，只阻断读取、传播或使用。
```

### Grow Unit Manager

Grow Unit Manager 应用 readiness verdict。

Evidence & Readiness 只产出 verdict。

事实：

```text
ready_to_hatch lifecycle 必须来自 ReadinessVerdict。
Evidence 不直接 transition grow unit。
```

### Hatch Builder

Hatch Builder 在 ready_to_hatch 后构建 package。

Evidence & Readiness 提供 verdict、evaluation、evidenceRefs 和 report。

事实：

```text
ready_to_hatch 不等于 hatch package 已发布。
Hatch Builder 仍可因发布边界、secret、资源缺失或 contract 不完整而失败。
```

## 不变量

```text
Readiness 不基于模型自信。
model_self_claim 不能单独通过 DoD。
Evidence candidate 不等于 accepted evidence。
artifact registration 不等于 evidence accepted。
DoD evaluation 不修改 DoD。
ReadinessVerdict 不修改 grow lifecycle。
ready_to_hatch 不构建 hatch package。
attempt completed 不等于 ready_to_hatch。
tool succeeded 不等于 DoD passed。
缺证据时必须返回 waiting_input、waiting_validation、continue_grow、blocked 或 inconclusive。
隐私未知或 policy blocked 的证据不能支撑发布级 readiness。
```

## 错误行为

该模块使用 `Result<DomainError>` 表达业务失败。

错误 code 至少覆盖：

```text
not_found
invalid_input
invalid_state
permission_denied
policy_blocked
privacy_blocked
version_unsupported
schema_incompatible
artifact_unavailable
evidence_unavailable
evidence_stale
evidence_conflict
dod_missing
dod_incompatible
readiness_blocked
readiness_inconclusive
validation_missing
```

事实：

```text
没有 active DoD 时不能产生 ready_to_hatch。
必要证据 artifact 不可读时返回 artifact_unavailable 或 evidence_unavailable。
证据版本与当前 DoD scope 不兼容时返回 dod_incompatible 或 evidence_stale。
contradicting evidence 未解释时返回 evidence_conflict 或 readiness_inconclusive。
隐私或 policy 阻断时不能静默忽略该证据后判 ready_to_hatch。
```

## 验证要求

实现阶段应验证：

```text
model_self_claim 不能单独让 DoD passed。
attempt completed 不会直接产生 ready_to_hatch。
tool_result 成功不等于 DoD passed。
没有 active DoD 时 readiness 不是 ready_to_hatch。
每个 DoDEvaluation 都列出 supporting、contradicting 和 missing evidence。
redacted/unavailable/retracted artifact 不能支撑 ready_to_hatch。
ReadinessVerdict 不调用 Grow Unit Manager transition。
Evidence 不调用 LLM Gateway 或 Tool Runtime。
ready_to_hatch verdict 被记录为事件并可解释证据链。
```

## 开放问题

```text
不同目标世界的最小 readiness gate 需要等 Target World Adapter 和 Runtime Contract Registry spec 联合收敛。
主观内容质量的人工 review 与 LLM judge 如何组合，需要在小说场景 proof slice 中验证。
Readiness report 的具体 artifact schema 属于实现阶段。
Evidence stream 是否独立于 grow_unit stream，需要与 Event Ledger 实现阶段共同判断。
```

这些问题不影响本模块当前终态事实：Evidence & Readiness 是证据、DoD evaluation 和 readiness verdict 的 owning module，不是模型自评器、验证执行平台、hatch builder 或 grow lifecycle owner。

