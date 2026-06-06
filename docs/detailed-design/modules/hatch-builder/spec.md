# Hatch Builder Spec

本文是 `Hatch Builder` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`Hatch Builder` 是从 grow 单元提取稳定能力并生成可复制 `hatch_package` artifact 的 owning module。

它把 ready_to_hatch verdict、locked runtime contract、被采纳资源、skill 版本、验证摘要、debug/feedback 能力和发布排除规则合成为可复制能力包。

它不复制 grow 目录，不构建 runtime contract，不判断 readiness，不运行 hatch 产物，也不自动更新下游环境。

## 职责

该模块负责：

```text
接收 HatchRequest。
校验 readiness verdict。
校验 locked RuntimeContractRef。
构建 HatchBuildPlan。
选择 included resources。
生成 HatchExclusionRecord。
选择可打包 skill version 和 asset。
检查 artifact lifecycle、privacy、retention 和 source。
请求 hatch.publish、artifact.export、secret/read 等 PolicyDecision。
生成 HatchPackageManifest。
生成 hatch_package artifact。
生成 HatchBuildReceipt。
记录 hatch package lifecycle。
提供 package explanation。
支持 package retraction、supersede 和 rollback metadata。
```

该模块不负责：

```text
判断 ready_to_hatch。
定义 Runtime Contract。
执行 runtime。
实现 Agent Runtime Kernel。
实现 Target World Adapter。
执行工具。
调用 LLM。
编译 runtime message list。
接收或采纳 feedback。
上传 debug trace。
自动更新下游运行环境。
远程分发平台。
插件市场。
复制 grow 目录。
```

## 依赖关系

```text
Depends on:
  Domain Model & Contracts
  File-Native Store
  Event Ledger & Projection
  Artifact Registry
  Policy & Capability Boundary
  Skill Registry
  Grow Unit Manager
  Evidence & Readiness
  Runtime Contract Registry

Used by:
  Grow Unit Manager
  Target World Adapter
  Agent Runtime Kernel
  Debug & Feedback Bridge
  CLI
```

事实：

```text
Hatch Builder 通过 Artifact Registry 创建 hatch_package artifact。
Hatch Builder 读取 Runtime Contract Registry 的 locked RuntimeContractRef。
Hatch Builder 读取 Evidence & Readiness 的 readiness verdict、DoD evaluation 和 evidence summary。
Hatch Builder 读取 Skill Registry 的 skill version、bodyRef、assetRefs、evidenceRefs 和 lifecycle。
Hatch Builder 通过 Policy 判断发布、导出、secret、debug/feedback 和 capability 边界。
Hatch Builder 通过 Event Ledger 写入 hatch package lifecycle。
```

## Hatch Request

HatchRequest 表达一次打包请求。

它至少包含：

```text
hatchRequestId
growUnitRef
readinessVerdictRef
runtimeContractRef
requestedVersion
targetPackageKind
publishMode
reason
requestedBy
source
audit
```

publishMode 至少包括：

```text
local_draft
local_release
workspace_import
external_export
```

事实：

```text
HatchRequest 不表示 package 已构建。
local_draft 仍需排除 secret。
external_export 需要更严格 PolicyDecision。
requestedVersion 不能覆盖已存在不可变 package version。
```

## Hatch Build Plan

HatchBuildPlan 是打包决策。

它至少包含：

```text
hatchBuildPlanId
hatchRequestRef
growUnitRef
readinessVerdictRef
runtimeContractRef
runtimeKernelType
candidateResourceRefs
includedResourceCandidates
excludedResourceCandidates
skillVersionCandidates
dependencySummary
debugFeedbackSummary
policyBoundarySummary
versionPlan
rollbackTarget
source
audit
```

事实：

```text
BuildPlan 是计划，不是 package。
BuildPlan 不复制文件。
BuildPlan 必须解释每个候选资源为何纳入或排除。
BuildPlan 不允许把整个 grow directory 当作资源候选。
```

## Resource Selection

HatchResource 表达 package 中的一个资源。

它至少包含：

```text
resourceId
artifactRef
role
sourceModule
inclusionReason
contentHash
privacyClass
retentionClass
targetPathHint
required
source
audit
```

role 至少包括：

```text
runtime_contract
runtime_entry
runtime_kernel_asset
skill_body
skill_asset
target_world_asset
source_material_snapshot
configuration_template
validation_summary
feedback_router_protocol
debug_support
license_or_notice
```

事实：

```text
included resource 必须有 ArtifactRef、contentHash 和 inclusionReason。
included resource 不包含 secret 原文。
source_material_snapshot 是受控快照，不是全部材料目录。
compiled_message_list 默认不进入 package。
attempt_trace 原文默认不进入 package。
validation_summary 可以进入 package，原始 trace 按 policy 决定。
```

## Exclusion Records

HatchExclusionRecord 表达一个候选为什么不进入 package。

原因至少包括：

```text
growth_noise
unaccepted_candidate
failed_attempt
raw_message_list
raw_attempt_trace
contains_secret
project_private
contains_user_content
policy_blocked
privacy_unknown
retracted_artifact
unavailable_artifact
archived_artifact
out_of_scope
runtime_incompatible
debug_only
temporary_context
local_only
duplicate_or_derived
```

事实：

```text
排除不删除原始 artifact。
排除清单必须进入 HatchPackageManifest 或 build report。
contains_secret 默认排除。
policy_blocked 不能被静默降级。
```

## Hatch Package Manifest

HatchPackageManifest 是 package 的核心说明。

它至少包含：

```text
packageName
packageVersion
hatchPackageRef
growUnitRef
runtimeContractRef
runtimeKernelType
readinessVerdictRef
evidenceSummaryRef
includedResources
excludedResources
skillVersions
dependencySummary
capabilitySummary
debugContractSummary
feedbackContractSummary
failureContractSummary
buildReceipts
policyDecisionRefs
rollbackTarget
createdAt
source
audit
```

事实：

```text
Manifest 是 package 内容索引和运行边界摘要。
Manifest 不包含 secret 原文。
Manifest 必须引用 RuntimeContractRef。
Manifest 必须包含 excludedResources summary。
Manifest 必须包含 rollbackTarget 或明确无 rollback target 的 reason。
```

## Hatch Package Record

HatchPackageRecord 是 hatch package 的业务事实。

它至少表达：

```text
hatchPackageId
hatchPackageRef
growUnitRef
runtimeContractRef
readinessVerdictRef
version
lifecycle
artifactRef
manifestRef
includedResourceRefs
excludedResourceRefs
policyDecisionRefs
validationSummaryRefs
buildReceiptRef
publishedAt
rollbackTarget
source
audit
```

lifecycle 使用 Domain Model & Contracts 的 hatch lifecycle：

```text
requested
building
verifying_contract
packaged
published_local
failed
retracted
```

事实：

```text
HatchPackageRecord 是 projection，不是真相来源。
artifactRef 指向 hatch_package artifact。
hatchPackageRef 不等于 growUnitRef。
hatchPackageRef 不等于 runtimeContractRef。
packaged 不表示已被外部环境安装。
published_local 不表示远程发布。
```

## Package Verification

HatchPackageVerification 至少检查：

```text
readinessVerdict 是 ready_to_hatch。
RuntimeContractRef lifecycle 是 locked_for_hatch。
runtime_contract artifact 可读。
所有 required resources 可读。
没有 retracted required artifact。
没有 contains_secret 原文进入 package。
project_private 和 contains_user_content 资源有 PolicyDecision 或已脱敏。
skill version 未 retracted、未 incompatible。
manifest 有 debug/feedback/failure summary。
package version 未冲突。
rollbackTarget 可解释。
```

事实：

```text
PackageVerification 是打包完整性检查，不运行目标世界。
PackageVerification 不替代 Evidence & Readiness。
PackageVerification 失败不修改 readiness verdict。
```

## Ports

### Hatch Port

```text
requestHatch(input) -> Result<HatchRequestRef>
buildHatchPlan(hatchRequestRef) -> Result<HatchBuildPlan>
buildHatchPackage(hatchBuildPlanRef) -> Result<HatchPackageRef>
verifyHatchPackage(hatchPackageRef) -> Result<HatchPackageVerification>
publishLocalHatchPackage(hatchPackageRef, reason) -> Result<HatchPublishReceipt>
```

事实：

```text
requestHatch 不构建 package。
buildHatchPlan 不复制文件。
buildHatchPackage 创建 hatch_package artifact。
publishLocalHatchPackage 只表示本地发布或本地可用，不表示远程分发。
```

### Lifecycle Port

```text
getHatchPackage(hatchPackageRef) -> Result<HatchPackageRecord>
listHatchPackages(growUnitRef, query) -> Result<HatchPackagePage>
retractHatchPackage(hatchPackageRef, reason) -> Result<HatchLifecycleReceipt>
supersedeHatchPackage(oldRef, newRef, reason) -> Result<HatchLifecycleReceipt>
explainHatchPackage(hatchPackageRef) -> Result<HatchPackageExplanation>
```

事实：

```text
retract 不删除历史 package record。
supersede 不改写旧 package version。
explain 返回 included/excluded、policy、readiness、contract 和 rollback 来源。
```

### Resource Port

```text
selectHatchResources(input) -> Result<HatchResourceSelection>
explainResourceInclusion(resourceRef) -> Result<ResourceInclusionExplanation>
explainResourceExclusion(exclusionRef) -> Result<ResourceExclusionExplanation>
```

事实：

```text
selectHatchResources 不读取被 policy 阻断的原文。
每个 resource candidate 都必须产生 include 或 exclude 结论。
```

## 事件

该模块写入 hatch_package stream。

事件类型至少包括：

```text
hatch_requested
hatch_build_plan_created
hatch_resource_included
hatch_resource_excluded
hatch_policy_checked
hatch_contract_verified
hatch_package_build_started
hatch_package_built
hatch_package_verified
hatch_package_published_local
hatch_package_failed
hatch_package_retracted
hatch_package_superseded
```

事实：

```text
事件 payload 保存 summary、Ref、version、policyDecisionId 和 contentHash，不内联大型 package 内容。
hatch_package artifact 由 Artifact Registry 保存。
纠错通过新事件表达，不改写旧 package version。
```

## 与其他模块的边界

### Evidence & Readiness

Evidence & Readiness 产出 ready_to_hatch verdict、evaluation 和 evidence summary。

Hatch Builder 使用这些事实作为打包前置条件。

事实：

```text
ready_to_hatch 是必要条件，不是 package 构建结果。
Hatch Builder 不修改 readiness verdict。
```

### Runtime Contract Registry

Runtime Contract Registry 提供 locked runtime contract。

Hatch Builder 引用该 contract。

事实：

```text
Hatch Builder 不定义 runtime contract。
Hatch Builder 不能使用 retracted 或 incompatible contract。
```

### Artifact Registry

Artifact Registry 保存资源和 hatch_package artifact。

Hatch Builder 选择资源并创建 hatch_package。

事实：

```text
Hatch Builder 是 hatch_package kind 的 owning creator。
Artifact Registry 不决定 package 内容。
```

### Policy & Capability Boundary

Policy 判断 artifact export、hatch.publish、secret、debug_trace.upload 和 feedback.upstream 边界。

Hatch Builder 执行排除、脱敏或阻断。

事实：

```text
Policy allow 不等于 package 已构建。
Policy deny 不能被静默降级。
```

### Skill Registry

Skill Registry 提供 skill version、bodyRef、assetRefs、evidenceRefs 和 lifecycle。

Hatch Builder 选择进入 package 的 skill version。

事实：

```text
retracted skill 不进入新 package。
active skill 不等于 packaged skill。
packaged skill version 必须可追溯。
```

### Grow Unit Manager

Grow Unit Manager 关联 hatch package 并更新 grow lifecycle。

Hatch Builder 产出 HatchPackageRef。

事实：

```text
Hatch Builder 不直接把 grow unit 改成 hatched。
Grow Unit Manager 应用 HatchPackageRef。
```

### Debug & Feedback Bridge

Debug & Feedback Bridge 使用 package 中的 debug/feedback contract 和资源。

Hatch Builder 只打包必要能力。

事实：

```text
Hatch Builder 不发送反馈。
Hatch package 中的 feedback 能力不等于默认上游吸收。
```

## 不变量

```text
Hatch Builder 不复制 grow 目录。
hatch_package artifact 只能由 Hatch Builder 创建。
ready_to_hatch 是 hatch 前置条件，不是 package。
locked RuntimeContractRef 是 package 前置条件。
runtime_contract artifact 不等于 hatch_package artifact。
compiled_message_list 默认不进入 package。
raw attempt_trace 默认不进入 package。
contains_secret 默认不进入 package。
unaccepted candidate 不进入 package。
retracted artifact 不进入新 package。
package version 不可原地修改。
published_local 不等于远程分发。
Hatch Builder 不自动更新下游 runtime。
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
readiness_failed
contract_not_ready
contract_retracted
package_version_conflict
resource_unavailable
resource_retracted
secret_detected
package_build_failed
package_verification_failed
```

事实：

```text
readinessVerdict 不是 ready_to_hatch 时返回 readiness_failed。
runtimeContract 不是 locked_for_hatch 时返回 contract_not_ready。
package version 已存在时返回 package_version_conflict。
contains_secret 资源未脱敏时返回 secret_detected 或 privacy_blocked。
required resource 不可读时返回 resource_unavailable。
```

## 验证要求

实现阶段应验证：

```text
不能从整个 grow 目录构建 package。
没有 ready_to_hatch verdict 不能 buildHatchPackage。
没有 locked RuntimeContractRef 不能 buildHatchPackage。
hatch_package kind 只能由 Hatch Builder 创建。
compiled_message_list 默认不进入 package。
raw attempt_trace 默认不进入 package。
contains_secret artifact 默认被排除。
retracted artifact 不能进入新 package。
每个候选资源都有 include 或 exclude 记录。
package version 不能原地修改。
publishLocalHatchPackage 不执行远程分发。
```

## 开放问题

```text
hatch package artifact 的具体文件布局属于实现阶段。
package version 采用 semver、content hash 或组合策略需要实现阶段确认。
local_draft 与 local_release 的默认 policy 差异需要与 CLI spec 联合确认。
自动更新和下游安装协议需要后续单独设计，不属于 Hatch Builder 第一阶段职责。
```

这些问题不影响本模块当前终态事实：Hatch Builder 是可复制 hatch_package 的构建层，不是 grow 目录复制器、readiness 裁判、runtime contract registry、运行时或自动更新系统。

