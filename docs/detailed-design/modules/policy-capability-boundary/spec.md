# Policy & Capability Boundary Spec

本文是 `Policy & Capability Boundary` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Policy & Capability Boundary` 是 feng 的动作边界决策层。它统一判断文件、命令、网络、外部服务、目标世界动作、artifact 读取/导出、反馈上报、hatch 发布、skill 启用和凭据访问是否允许、是否需要确认、是否需要脱敏、是否需要附加约束，或当前运行环境是否无法安全支持。

它不是强安全沙箱。它必须诚实声明每个 decision 依赖的真实边界：结构性 guard、policy decision、人工 approval、host sandbox、外部 enforcement、advisory only 或 unsupported。

## 职责

该模块负责：

```text
定义 capability 域和 action request。
根据 policy context 生成 policy decision。
表达 allow、deny、ask、allow_with_constraints、allow_with_redaction、unsupported。
表达真实执行边界和不能保证的范围。
管理 scoped approval、grant 和 revocation。
为高风险动作生成可审计 policy decision 事件。
为 artifact export、feedback upstream 和 hatch publish 判断隐私/发布边界。
为 target world action、tool action 和 external service action 提供统一边界判断。
向调用方返回 constraints、requiredApproval、redactionRequirement、evidenceRequirement 和 explanation。
```

该模块不负责：

```text
OS sandbox 实现。
文件路径 containment。
工具执行。
网络请求执行。
目标世界动作执行。
artifact 内容保存或 materialization。
feedback 采纳状态转换。
hatch package 内容选择和构建。
skill 内容加载和版本解析。
secret storage。
LLM 调用。
用户界面。
具体 policy 配置文件 schema。
```

## 依赖关系

```text
Depends on:
  Domain Model & Contracts
  File-Native Store
  Event Ledger & Projection
  Artifact Registry

Used by:
  Skill Registry
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
Policy 可以读取 policy 配置事实、decision/grant 事件、artifact metadata 和 contract summary。
Policy 不直接依赖 Tool Runtime、Hatch Builder、Feedback Inbox 或 Agent Runtime Kernel。
调用方先取得 PolicyDecision，再执行自己的模块动作。
```

## 核心类型族

### Capability

该模块定义 capability 域。第一阶段必须表达：

```text
file.read
file.write
file.delete
command.run
network.request
external_service.call
artifact.read
artifact.export
feedback.upstream
hatch.publish
runtime.target_action
skill.activate
secret.read
debug_trace.upload
```

事实：

```text
capability 是动作域，不是工具名。
一个工具或 runtime 动作可以请求多个 capability。
未知 capability 返回 unsupported 或 deny，不静默允许。
```

### Action Request

每次高风险动作都以 action request 进入 Policy。

Action request 至少表达：

```text
requestId
capability
requestedByModule
workspace
growUnit
attempt
runtime
targetWorld
artifactRefs
skillRefs
resourceSummary
operation
reason
source
correlationId
```

事实：

```text
request 描述想做什么，不携带大型内容。
大型内容通过 ArtifactRef 或 summary 表达。
request 必须有 reason 和 source。
request 不等同于 action 已经发生。
```

### Policy Context

Policy context 是 decision 的依据。

它至少包含：

```text
active grow lifecycle summary
attempt summary where applicable
runtime contract summary where applicable
target world contract summary where applicable
artifact privacy/source/retention summary
skill descriptor summary
existing grants
caller identity
environment capability summary
```

事实：

```text
Policy context 由调用方和 Policy 共同构造。
Policy 可以通过 Artifact Registry 读取 metadata 和 preview summary。
Policy 不为了决策读取完整大内容，除非请求本身就是受控 artifact.read。
```

### Policy Decision

Policy decision 至少表达：

```text
policyDecisionId
requestId
verdict
constraints
requiredApproval
requiredRedaction
requiredEvidence
boundaryDeclaration
expiresAt
source
audit
explanation
```

verdict 至少包括：

```text
allow
deny
ask
allow_with_constraints
allow_with_redaction
unsupported
```

事实：

```text
allow 表示 policy 层允许，不表示动作已经执行。
deny 是显式阻断，不允许调用方静默降级为 allow。
ask 必须获得 approval receipt 或 scoped grant 后才能继续。
allow_with_constraints 要求调用方执行约束。
allow_with_redaction 要求调用方使用脱敏后的内容或脱敏后的 artifact。
unsupported 表示当前系统不具备可信执行边界或不认识该能力。
```

### Boundary Declaration

每个 decision 都声明真实边界等级。

boundary declaration 至少表达：

```text
structural_guard
policy_decision
human_approval
host_sandbox_required
external_enforcement
advisory_only
unsupported
```

事实：

```text
structural_guard 表示还依赖 File Store、Tool Runtime 或 Target World Adapter 的结构性检查。
policy_decision 表示 feng 内部策略允许或拒绝。
human_approval 表示需要人工确认。
host_sandbox_required 表示安全性依赖宿主沙箱或 OS 隔离。
external_enforcement 表示安全性依赖外部服务、游戏引擎或运行平台。
advisory_only 表示 feng 只能给出建议，不能强制执行。
unsupported 表示不能安全支持。
```

### Approval, Grant, and Revocation

该模块管理 scoped approval 和 grant。

approval/grant 至少表达：

```text
grantId
capability
scope
subject
approvedBy
reason
constraints
createdAt
expiresAt
revokedAt
source
audit
```

事实：

```text
approval 是一次确认事实。
grant 是有作用域和有效期的能力授权。
grant 不默认跨 workspace、grow unit、runtime 或 target world 生效。
revocation 通过追加事件表达，不修改历史 approval。
```

## Ports

### Decision Port

```text
evaluateAction(request, context) -> Result<PolicyDecision>
explainDecision(policyDecisionId) -> Result<PolicyDecisionExplanation>
```

事实：

```text
evaluateAction 不执行 action。
每个高风险 decision 写入 policy stream。
低风险 decision 可以按配置聚合审计，但仍能被解释。
```

### Approval Port

```text
recordApproval(request, approvalInput) -> Result<ApprovalReceipt>
createGrant(approval, scope) -> Result<CapabilityGrant>
revokeGrant(grantId, reason) -> Result<RevocationReceipt>
listActiveGrants(scope) -> Result<CapabilityGrantList>
```

事实：

```text
approval 和 grant 都有来源、原因、作用域和过期策略。
grant 被撤销后不再用于新 decision。
历史 decision 不因撤销而被重写。
```

### Boundary Port

```text
describeBoundary(capability, environment) -> Result<BoundaryDeclaration>
requireBoundary(capability, requiredLevel) -> Result<BoundaryCheck>
```

事实：

```text
Boundary Port 用于避免把 advisory decision 误当成 hard security。
当 capability 要求 host sandbox 而当前环境没有该能力时，结果为 unsupported 或 ask，不静默 allow。
```

### Privacy and Publish Port

```text
evaluateArtifactAccess(request, artifactSummary) -> Result<PolicyDecision>
evaluateFeedbackUpstream(request, feedbackSummary) -> Result<PolicyDecision>
evaluateHatchPublish(request, hatchSummary) -> Result<PolicyDecision>
```

事实：

```text
artifact privacy/source/retention 必须参与读取、导出、上报和发布判断。
contains_secret、project_private、contains_user_content 默认不能无确认上报到上游或发布。
redactionRequirement 是 decision 的一部分，不是 UI 提示。
```

## 事件

该模块写入 policy stream。

事件类型至少包括：

```text
policy_decision_recorded
approval_recorded
capability_grant_created
capability_grant_revoked
policy_boundary_declared
policy_decision_superseded
```

事实：

```text
Policy 事件通过 Event Ledger 追加。
Policy 事件 payload 只保存 summary 和 Ref，不内联大型内容。
Policy decision 可以被 Tool Runtime、Hatch Builder、Feedback Bridge 和 CLI 审计引用。
纠错通过 superseding event，不改写旧 decision。
```

## 与其他模块的边界

### File-Native Store

File Store 负责路径解析、containment、symlink escape 拒绝和原子读写。

Policy 负责业务动作是否允许。

事实：

```text
Policy allow 不会绕过 File Store 的结构安全检查。
File Store 不判断某个业务动作是否应该被允许。
```

### Artifact Registry

Artifact Registry 拥有 artifact metadata、privacy、lifecycle、preview 和 materialization。

Policy 根据 artifact summary 判断读取、导出、上报和发布边界。

事实：

```text
Artifact Registry 暴露 privacy metadata。
Policy 不拥有 artifact 内容生命周期。
redacted/unavailable artifact 的读取仍由 Artifact Registry 返回显式状态。
```

### Event Ledger & Projection

Event Ledger 保存 policy decision、approval、grant 和 revocation 事件。

Policy 拥有这些事件的语义。

### Tool Runtime

Tool Runtime 在执行工具前请求 policy decision，并在执行后归档 tool result。

Policy 不执行工具，不解析工具完整输出。

### Hatch Builder

Hatch Builder 在打包、发布和排除资源前请求 policy decision。

Policy 不选择 hatch package 内容，但可以要求排除、脱敏、确认或阻断。

### Admission & Feedback Inbox

Admission & Feedback Inbox 拥有 feedback 状态转换。

Policy 判断 feedback upstream、debug trace upload 和隐私边界。

事实：

```text
上报允许不等于上游吸收。
上报被拒绝不等于本地 feedback 被删除。
```

### Target World Adapter

Target World Adapter 归一化目标世界动作和结构约束。

Policy 判断 runtime.target_action 是否允许、是否需要确认、是否依赖外部 enforcement。

## 不变量

```text
高风险动作必须有 PolicyDecision。
PolicyDecision 不是动作执行结果。
Policy allow 不绕过 File Store、Tool Runtime、Hatch Builder 或 Target World Adapter 的结构检查。
Policy deny 不能被调用方静默降级。
Policy ask 必须绑定 approval receipt 或 scoped grant。
unsupported 必须显式失败。
artifact export、feedback upstream 和 hatch publish 必须读取 privacy/source/retention summary。
contains_secret 默认不能上报、发布或进入 hatch package。
grant 必须有 scope 和 expiration。
policy 事件 append-only。
```

## 错误行为

该模块使用 `Result<DomainError>` 表达业务失败。

错误 code 至少覆盖：

```text
permission_denied
policy_blocked
privacy_blocked
invalid_input
invalid_state
version_unsupported
schema_incompatible
artifact_unavailable
approval_required
grant_expired
grant_revoked
boundary_unsupported
external_enforcement_unavailable
```

事实：

```text
缺少必要 context 时返回 invalid_input 或 ask。
需要 approval 而未获得时返回 approval_required。
要求 host sandbox 但环境不支持时返回 boundary_unsupported。
artifact metadata 不可用时，高风险 export/upstream/publish 默认失败。
```

## 验证要求

实现阶段应验证：

```text
高风险 capability 请求没有 decision 时无法进入执行模块。
contains_secret artifact 的 export/upstream/publish 默认被阻断或要求脱敏与确认。
ask verdict 没有 approval receipt 时不能继续。
revoked grant 不再影响新 decision。
unsupported capability 不会被当作 allow。
policy decision event 可通过 policy stream replay。
File Store 路径逃逸即使 policy allow 仍失败。
Tool Runtime、Hatch Builder、Feedback Bridge 只能引用 decision，不直接改写 decision。
```

## 开放问题

```text
policy 配置文件的具体 schema 属于实现阶段。
是否接入 OS sandbox、Windows job object、container 或外部 runner 属于宿主集成设计。
approval 的用户交互形态需要等 CLI spec 确认。
secret storage 归属需要在 Tool Runtime、LLM Gateway 或专门凭据模块设计时确认。
```

这些问题不影响本模块当前终态事实：Policy & Capability Boundary 是可审计的动作边界决策层，不是执行层，也不是强安全沙箱。
