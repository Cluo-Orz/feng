# Skill Registry Spec

本文是 `Skill Registry` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Skill Registry` 是 feng 的 skill catalog 和 lifecycle 管理层。它管理 skill 的发现、注册、版本、来源、启用状态、作用域、按需加载、禁用、pin、rollback、body artifact 引用和默认 feedback router skill。

它不是插件市场，不是 prompt 自动拼装器，也不是安全边界。

## 职责

该模块负责：

```text
登记 skill descriptor。
管理 skill source、version、scope、lifecycle 和 audit。
保存 skill body、asset、reference 的 ArtifactRef。
提供 skill catalog 查询。
提供 skill body 按需 materialization。
管理 skill activation、disable、pin、rollback 和 retraction。
在 skill activation 前取得 PolicyDecision。
记录 skill lifecycle 事件。
维护默认 feedback router skill family 的版本关系。
提供 Context & Message Compiler 可用的 skill candidate summary。
```

该模块不负责：

```text
把 skill 自动塞进 prompt。
决定本轮 message list 可见 skill。
执行 skill。
执行工具。
管理工具 registry。
判断工具权限。
管理 feedback 状态转换。
判断上游是否吸收反馈。
判断 readiness。
hatch 打包。
提供插件市场。
提供 MCP adapter。
保存大型 skill 正文内容本身。
```

## 依赖关系

```text
Depends on:
  Domain Model & Contracts
  File-Native Store
  Event Ledger & Projection
  Artifact Registry
  Policy & Capability Boundary

Used by:
  Grow Unit Manager
  Admission & Feedback Inbox
  Agenda & DoD Manager
  Context & Message Compiler
  Tool Runtime
  Grow Attempt Runner
  Evidence & Readiness
  Hatch Builder
  Runtime Contract Registry
  Agent Runtime Kernel
  Target World Adapter
  Debug & Feedback Bridge
  CLI
```

事实：

```text
Skill Registry 通过 Artifact Registry 保存和读取 skill_body artifact。
Skill Registry 通过 Event Ledger 记录 skill lifecycle。
Skill Registry 通过 Policy 请求 skill.activate decision。
Skill Registry 不直接依赖 Context & Message Compiler。
```

## 核心类型族

### Skill Record

每个 skill 都有一个 SkillRecord。

SkillRecord 至少表达：

```text
skillId
skillRef
name
family
version
lifecycle
source
scope
description
triggerSummary
bodyRef
assetRefs
referenceRefs
declaredCapabilities
declaredToolRefs
compatibility
privacyClass
evidenceRefs
rollbackTarget
audit
```

事实：

```text
SkillRecord 是 catalog 事实，不是 prompt 内容。
bodyRef 指向 Artifact Registry 中的 skill_body artifact。
triggerSummary 用于候选检索，不等于自动触发。
declaredCapabilities 只说明 skill 可能需要的能力，不授予权限。
```

### Skill Source

skill source 至少表达：

```text
system_default
workspace_local
grow_generated
hatch_imported
user_imported
upstream_proposed
external_package
```

事实：

```text
source 进入 audit 和 version 事实。
upstream_proposed 不等于 accepted。
external_package 默认需要 policy decision 才能启用。
grow_generated skill 默认是候选，不能直接成为 active。
```

### Skill Lifecycle

skill lifecycle 至少表达：

```text
discovered
candidate
registered
active
disabled
pinned
archived
retracted
superseded
incompatible
```

事实：

```text
discovered 表示被发现但未纳入 catalog。
candidate 表示等待验证或采纳。
registered 表示 catalog 已有记录。
active 表示在作用域内可作为候选。
pinned 表示作用域内锁定某个 version。
disabled 表示作用域内不可作为候选。
retracted 表示不应用于未来 grow、hatch 或 runtime。
superseded 表示已有替代 version。
incompatible 表示版本或 contract 与当前环境不兼容。
```

### Skill Scope

skill activation scope 至少表达：

```text
workspace
grow_unit
attempt
runtime_contract
hatch_package
target_world
system_default
```

事实：

```text
scope 决定 activation 的生效边界。
workspace active 不等于所有 grow unit 都必须加载。
attempt scope 只影响本次 attempt 的候选集合。
runtime_contract scope 用于 hatch runtime 的运行能力。
```

### Skill Activation

SkillActivation 表达某个 skill version 在某个 scope 下的启用状态。

SkillActivation 至少包含：

```text
activationId
skillRef
version
scope
status
policyDecisionId
reason
activatedBy
createdAt
expiresAt
evidenceRefs
audit
```

status 至少包括：

```text
enabled
disabled
pinned
rolled_back
expired
blocked
```

事实：

```text
activation 是候选可用性事实，不是 message list visibility。
activation 需要有效 PolicyDecision。
pinned version 不因新 version 出现而自动切换。
rollback 通过新的 activation 事件表达，不改写历史记录。
```

## Default Feedback Router Skill

Skill Registry 必须登记一个 `default_feedback_router` skill family。

事实：

```text
default_feedback_router 是 system_default skill family。
它默认存在于 feng 能力集合中。
它可以被禁用、pin、rollback 或用新 version supersede。
它的变更必须有 source、version、evidenceRefs、audit 和 rollbackTarget。
它不直接修改 feedback status。
它不直接向上游写入 grow 事实。
```

该 family 分为两类引用：

```text
stable protocol contract ref
versioned scenario strategy body ref
```

事实：

```text
stable protocol contract 表达反馈候选、证据、归因、隐私边界、上游提议的基础协议。
versioned scenario strategy 表达具体场景下如何分类、摘要、脱敏和建议路由。
基础协议稳定，场景策略可 grow。
```

在 `feng -> xiaoshuo -> libai` 链路中：

```text
feng 的 default_feedback_router 版本可随 feng 自身 grow 演进。
xiaoshuo 可以继承或覆盖该 skill 的场景策略。
libai 项目的运行反馈先成为作品项目内的反馈候选。
作品原文不因 default_feedback_router 存在而默认流向 feng。
```

## Ports

### Catalog Port

```text
discoverSkills(scope) -> Result<SkillDiscoveryReport>
registerSkill(input) -> Result<SkillRef>
getSkill(skillRef) -> Result<SkillRecord>
listSkills(query) -> Result<SkillCatalogPage>
```

事实：

```text
discover 不等于 register。
register 不等于 active。
catalog 查询默认返回 descriptor summary，不返回完整 body。
```

### Version Port

```text
addSkillVersion(skillRef, versionInput) -> Result<SkillRef>
compareSkillVersions(skillRef, a, b) -> Result<SkillVersionDiffSummary>
retractSkillVersion(skillRef, version, reason) -> Result<SkillLifecycleReceipt>
```

事实：

```text
skill version 不可原地修改。
新内容产生新 version。
retract 不删除历史 record。
diff summary 用于审计和 Context Compiler 判断候选，不是代码 merge 工具。
```

### Activation Port

```text
activateSkill(skillRef, scope, reason) -> Result<SkillActivation>
disableSkill(skillRef, scope, reason) -> Result<SkillActivation>
pinSkillVersion(skillRef, version, scope, reason) -> Result<SkillActivation>
rollbackSkill(skillRef, scope, rollbackTarget, reason) -> Result<SkillActivation>
listActiveSkills(scope) -> Result<ActiveSkillList>
```

事实：

```text
activate、pin 和 rollback 需要 PolicyDecision。
disable 不删除 skill record。
listActiveSkills 返回候选列表，不保证进入下一轮 message list。
```

### Materialization Port

```text
loadSkillBody(skillRef, options) -> Result<SkillBodyMaterialization>
loadSkillSummary(skillRef, options) -> Result<SkillSummaryMaterialization>
```

事实：

```text
loadSkillBody 通过 Artifact Registry materialize bodyRef。
materialization 记录 reason、source、version、readReceipt 和 privacy。
调用方必须说明加载原因。
Context Compiler 使用 materialization 结果编译 message list。
```

### Candidate Port

```text
findSkillCandidates(contextSummary) -> Result<SkillCandidateList>
explainSkillCandidate(skillRef, contextSummary) -> Result<SkillCandidateExplanation>
```

事实：

```text
candidate 是候选，不是注入结果。
candidate explanation 必须包含匹配原因、scope、version、source 和限制。
最终可见性由 Context & Message Compiler 写入 message list 来源说明。
```

## 事件

该模块写入 skill stream。

事件类型至少包括：

```text
skill_discovered
skill_registered
skill_version_added
skill_activation_changed
skill_version_pinned
skill_disabled
skill_rollback_recorded
skill_version_retracted
skill_body_ref_updated
default_feedback_router_version_changed
```

事实：

```text
Skill 事件通过 Event Ledger 追加。
Skill 事件 payload 保存 descriptor summary、version、scope、policyDecisionId 和 ArtifactRef。
大型 skill body 不内联进事件。
纠错通过新事件表达，不改写旧事件。
```

## 与其他模块的边界

### Artifact Registry

Artifact Registry 保存 skill_body、reference、asset 和 preview。

Skill Registry 保存 skill catalog、version、activation 和 lifecycle。

事实：

```text
skill body 是 artifact。
skill body lifecycle 与 skill lifecycle 相关但不相同。
bodyRef 不可用时，Skill Registry 返回 artifact_unavailable。
```

### Policy & Capability Boundary

Policy 判断 skill.activate 是否允许。

Skill Registry 管理 activation 事实。

事实：

```text
外部来源、grow_generated、upstream_proposed skill 默认需要 policy decision 才能 active。
Skill Registry 不把 declaredCapabilities 当权限授予。
```

### Context & Message Compiler

Context Compiler 决定本轮哪些 skill 进入 message list。

Skill Registry 提供 active skill、candidate、summary 和 body materialization。

事实：

```text
active skill 不等于 visible skill。
visible skill 必须写入 message list 来源说明。
Skill Registry 不拼接 prompt。
```

### Admission & Feedback Inbox

Admission & Feedback Inbox 管理 feedback candidate、accepted、rejected、proposed_upstream 等状态。

default_feedback_router skill 提供路由策略或协议贡献。

事实：

```text
default_feedback_router 不直接修改 feedback status。
反馈上报不因 skill 存在而自动吸收。
```

### Tool Runtime

Tool Runtime 管理工具 registry、工具输入校验、执行和结果归档。

Skill Registry 只记录 skill 声明的 capability/tool 需求。

事实：

```text
declaredToolRefs 不注册工具。
declaredCapabilities 不授予权限。
```

### Hatch Builder

Hatch Builder 决定哪些 skill 版本进入 hatch package。

Skill Registry 提供 skill version、source、bodyRef、assetRefs、evidenceRefs 和 lifecycle。

事实：

```text
hatch package 不复制未采纳、retracted 或 incompatible skill。
Skill Registry 不构建 hatch package。
```

## 不变量

```text
Skill Registry 不自动注入 prompt。
Skill Registry 不执行 skill。
Skill body 通过 ArtifactRef 表达。
Skill activation 不等于 message list visibility。
Skill activation 需要 PolicyDecision。
Skill version 不可原地修改。
rollback 不改写历史。
default_feedback_router 默认存在但不绕过反馈准入。
upstream_proposed skill 不等于 accepted skill。
declaredCapabilities 不授予权限。
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
skill_incompatible
skill_retracted
activation_blocked
rollback_target_missing
```

事实：

```text
retracted skill 被 activate 时返回 skill_retracted。
bodyRef 不可用时返回 artifact_unavailable。
policy deny 时 activation 返回 policy_blocked。
rollback target 不存在时返回 rollback_target_missing。
incompatible skill 不进入 active candidates。
```

## 验证要求

实现阶段应验证：

```text
active skill 不会自动进入 message list。
skill body 不会被内联进 skill lifecycle event。
external_package skill 没有 PolicyDecision 时不能 active。
upstream_proposed skill 默认不是 active。
rollback 通过新事件表达，旧 version 仍可审计。
default_feedback_router 存在且有 protocol contract ref。
default_feedback_router 不直接修改 feedback status。
declaredCapabilities 不绕过 Policy。
```

## 开放问题

```text
Skill descriptor 的最终持久化 schema 属于实现阶段。
Skill body 的具体文件格式需要等 Context & Message Compiler spec 决定可见片段模型。
default_feedback_router 的基础协议最小字段需要与 Admission & Feedback Inbox、Debug & Feedback Bridge 联合确定。
Skill 与 Memory 是否共享部分 materialization 机制，需要等 Context Compiler spec 后判断。
```

这些问题不影响本模块当前终态事实：Skill Registry 是可审计、可版本化、可回滚的 skill catalog 和 lifecycle 管理层，不是插件市场、prompt 拼装器或反馈采纳器。
