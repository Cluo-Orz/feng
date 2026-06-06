# CLI Spec

本文是 `CLI` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`CLI` 是 feng 的本地用户入口。

它把命令行输入解析成可审计的 command intent，定位 workspace，调用 grow、admission、agenda、attempt、readiness、hatch、runtime、debug、policy 等模块的 ports，并把结果渲染成用户能理解的状态、缺口、下一步和错误原因。

它不是业务状态拥有者，不是 LLM loop，不是工具执行器，不是调试 UI 框架，也不是 session manager。

## 职责

该模块负责：

```text
解析 argv、环境变量和当前工作目录。
请求 File-Native Store 定位 workspace。
把用户命令归一化为 CLICommandIntent。
识别命令所属的 command family。
把命令派发到对应模块 port。
处理 Policy ask / approval / grant 的用户入口。
展示 grow state、agenda、gap、DoD、readiness、hatch、runtime、debug 和 feedback 的 summary。
展示 explain 结果和 source refs。
展示 DomainError 的明确原因。
生成 CLIInvocationReceipt。
维护非业务性质的命令调用审计。
保证输出不泄露 policy 阻断或隐私受限的原文。
```

该模块不负责：

```text
直接写 grow 事实文件。
直接追加业务事件。
直接创建 compiled_message_list。
直接创建 runtime_message_list。
调用 LLM provider。
执行工具。
判断 readiness。
构建 hatch package 内容。
执行目标世界动作。
采纳 feedback。
修改 feedback status。
维护用户可见 session。
保存 provider session。
把命令历史当成 grow 记忆。
实现完整命令手册。
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
  Admission & Feedback Inbox
  Agenda & DoD Manager
  Context & Message Compiler
  LLM Gateway
  Tool Runtime
  Grow Attempt Runner
  Evidence & Readiness
  Runtime Contract Registry
  Hatch Builder
  Target World Adapter
  Agent Runtime Kernel
  Debug & Feedback Bridge

Used by:
  human operator
  local scripts
  development workflow
  target world host integration when it shells into feng
```

事实：

```text
CLI 调用 File-Native Store 获取 WorkspaceHandle。
CLI 调用 Grow Unit Manager 打开、创建、解释和协调 grow unit。
CLI 调用 Admission & Feedback Inbox 接收用户输入、材料、runtime report 和 feedback。
CLI 调用 Agenda & DoD Manager 获取 gap、agenda、DoD 和 attempt intent summary。
CLI 调用 Grow Attempt Runner 执行一次 grow attempt。
CLI 调用 Evidence & Readiness 获取 readiness verdict 和 explanation。
CLI 调用 Runtime Contract Registry 查看或锁定 contract 状态。
CLI 调用 Hatch Builder 请求、构建、验证和本地发布 hatch package。
CLI 调用 Target World Adapter 归一化目标世界输入、验证和 debug signal。
CLI 调用 Agent Runtime Kernel 运行支持 agent kernel 的 hatch package。
CLI 调用 Debug & Feedback Bridge 打开 debug correlation、提交 feedback candidate 或请求 upstream proposal。
CLI 调用 Policy & Capability Boundary 解释 decision、记录 approval、创建或撤销 grant。
CLI 不绕过这些模块直接写 file-native 事实。
```

## Command Family

CLI command family 是用户意图的粗分类，不是完整命令手册。

第一阶段至少表达：

```text
workspace
grow
input
status
explain
attempt
readiness
hatch
runtime
debug
feedback
policy
artifact
skill
```

事实：

```text
command family 只决定派发路径。
具体命令名、flag、别名和交互形态属于 CLI 语法层。
command family 不拥有业务状态。
```

## CLI Command Intent

CLICommandIntent 表达一次命令被解析后的业务意图。

它至少包含：

```text
commandIntentId
commandFamily
workspaceInput
growUnitRef
hatchPackageRef
runtimeContractRef
targetWorldRef
artifactRefs
feedbackUnitRefs
policyDecisionRefs
rawArgsRef
stdinRef
environmentSummary
requestedMode
approvalMode
displayMode
source
audit
```

requestedMode 至少包括：

```text
normal
dry_run
debug
replay
explain_only
machine_readable
```

approvalMode 至少包括：

```text
never
ask
preapproved_scope
explain_only
```

displayMode 至少包括：

```text
human_summary
json
quiet
verbose
source_refs
```

事实：

```text
CLICommandIntent 不是业务事件。
rawArgsRef 和 stdinRef 是审计引用，不进入 grow message list。
命令行参数不自动成为 admitted material。
用户输入必须通过 Admission & Feedback Inbox 才能进入 grow 候选。
```

## CLI Execution Context

CLIExecutionContext 表达一次命令派发时可用的本地上下文。

它至少包含：

```text
workspaceHandle
workspaceRootSummary
activeGrowUnitRef
environmentCapabilitySummary
activeGrantRefs
policyBoundarySummary
terminalCapabilitySummary
processInfoSummary
source
audit
```

事实：

```text
CLIExecutionContext 不是 session。
processInfoSummary 不进入 grow unit contract。
终端进程结束不影响 file-native grow 状态。
恢复工作依赖 Event Ledger、ArtifactRef、projection 和模块 checkpoint，不依赖 CLI 进程内存。
```

## CLI Invocation Receipt

CLIInvocationReceipt 表达一次命令的可解释回执。

它至少包含：

```text
cliInvocationId
commandIntentRef
workspaceRef
growUnitRef
calledModuleRefs
resultRefs
policyDecisionRefs
approvalReceiptRefs
artifactRefs
eventRefs
startedAt
completedAt
exitStatus
displaySummaryRef
source
audit
```

exitStatus 至少包括：

```text
succeeded
succeeded_with_warnings
waiting_input
waiting_approval
blocked_by_policy
blocked_by_privacy
blocked_by_readiness
unsupported
failed
interrupted
```

事实：

```text
CLIInvocationReceipt 是命令审计，不是业务真相来源。
resultRefs 指向业务模块产出的 receipt、event、artifact、verdict 或 explanation。
exitStatus 不等于 grow lifecycle。
command succeeded 不等于 ready_to_hatch。
```

## CLI Output Envelope

CLIOutputEnvelope 表达 CLI 对用户展示的输出。

它至少包含：

```text
outputId
commandIntentRef
exitStatus
headline
summary
nextActions
sourceRefs
hiddenRefs
warningRefs
policyExplanations
privacyExplanations
machineReadableRef
source
audit
```

nextActions 至少包括：

```text
provide_input
run_grow_again
review_gap
approve_policy_request
inspect_evidence
request_hatch
lock_runtime_contract
build_hatch_package
run_hatch_package
open_debug
submit_feedback
wait_for_external_result
```

事实：

```text
CLI output 是展示结果，不是新的 grow fact。
sourceRefs 必须能解释关键状态来自哪些模块。
hiddenRefs 记录因 privacy 或 policy 未展示的内容引用。
machine_readable 输出不得绕过 privacy 限制。
```

## 用户心智

CLI 对用户呈现的核心心智是：

```text
在当前目录运行 feng。
feng 打开这个目录里的一个 grow unit。
每次 grow 推进这个 grow unit。
状态、缺口、证据和下一步都能解释来源。
hatch 是从 ready grow unit 构建可复制 package。
run/debug 是运行 hatch package 或读取运行反馈。
```

事实：

```text
CLI 不要求用户理解 session。
同一个 grow unit 下不暴露多个用户 session。
attempt、runtime invocation、debug correlation 和 command invocation 都不是用户心智中的 session。
CLI 可以显示这些 ref 供调试，但不能把它们包装成会话产品概念。
```

## Workspace 行为

事实：

```text
CLI 只能在 File-Native Store 认可的 workspace 内工作。
workspace 定位失败时，CLI 返回明确错误或引导创建 grow unit。
CLI 不接受 workspace 外裸路径作为业务写入目标。
CLI 不把当前工作目录扫描结果自动准入为 material。
目录材料必须通过 Admission & Feedback Inbox。
```

当 workspace 中不存在 grow unit 时：

```text
带明确目标的 grow/create 类 intent 可以请求 Grow Unit Manager 创建 grow unit。
纯 status/explain 类 intent 返回没有 grow unit 的可解释状态。
CLI 不创建隐藏 grow unit。
```

## Grow Command Boundary

grow family 的命令至少覆盖：

```text
接收用户目标或补充输入。
提交材料候选。
查看当前 gap 和 DoD。
请求下一轮 attempt intent。
运行一次 bounded grow attempt。
展示 attempt outcome。
展示下一步。
```

事实：

```text
用户输入先进入 Admission & Feedback Inbox。
AttemptIntent 由 Agenda & DoD Manager 生成。
一次 grow command 可以触发一次 Grow Attempt Runner 执行，但不能手写 message list。
Grow Attempt Runner 每轮 message list 由 Context & Message Compiler 生成。
grow command 成功不等于 ready_to_hatch。
```

## Hatch Command Boundary

hatch family 的命令至少覆盖：

```text
查看 readiness。
查看 runtime contract 状态。
请求 hatch。
构建 hatch plan。
构建 hatch package。
验证 hatch package。
本地发布 hatch package。
解释 package 内容和排除项。
```

事实：

```text
没有 ready_to_hatch verdict 时 CLI 不能要求 Hatch Builder 构建 package。
没有 locked RuntimeContractRef 时 CLI 不能要求 Hatch Builder 构建 package。
CLI 不复制 grow 目录。
CLI 不手选资源绕过 Hatch Builder。
publish local 不等于远程分发。
```

## Runtime Command Boundary

runtime family 的命令至少覆盖：

```text
查看 hatch package 的 runtime kernel type。
准备目标世界输入。
启动 runtime invocation。
执行 runtime turn。
查看 runtime trace。
解释 runtime output、tool settlement 和 target action。
```

事实：

```text
CLI 不强制所有 hatch 产物使用 Agent Runtime Kernel。
standard_agent_kernel、custom_agent_kernel 或 hybrid_runtime 的 agent 部分可以进入 Agent Runtime Kernel。
non_llm_runtime 不能被 CLI 强行塞进 Agent Runtime Kernel。
target action 仍必须经过 Target World Adapter 和 Policy。
runtime output 不等于目标世界已接受。
```

## Debug and Feedback Command Boundary

debug / feedback family 的命令至少覆盖：

```text
打开 DebugCorrelation。
关联 runtime trace 或 target debug signal。
生成 feedback bridge packet。
提交 feedback candidate。
请求 upstream proposal。
解释 feedback attribution、privacy filter 和 policy decision。
```

事实：

```text
CLI 不把 runtime trace 直接写成 feedback accepted。
CLI 不直接创建 UpstreamProposal。
CLI 通过 Debug & Feedback Bridge 和 Admission & Feedback Inbox 完成反馈候选流转。
unknown attribution 时 CLI 不自动上游。
```

## Policy Approval Boundary

policy family 的命令至少覆盖：

```text
解释 PolicyDecision。
展示 ask verdict。
记录 approval。
创建 scoped grant。
撤销 grant。
列出当前有效 grant。
```

事实：

```text
CLI 只能通过 Policy Approval Port 记录 approval 或 grant。
approval 不等于动作已经执行。
grant 必须有 scope 和 expiration。
CLI 不能把 deny 当成 allow。
unsupported 必须明确失败。
```

## Explain Boundary

explain family 的命令可以解释：

```text
grow unit state。
admission decision。
agenda/gap/DoD。
attempt。
compiled message list。
readiness verdict。
runtime contract。
hatch package。
runtime invocation。
debug bridge packet。
policy decision。
artifact metadata。
skill summary。
```

事实：

```text
explain 读取 summary、source map、event refs 和 artifact metadata。
explain 不读取被 policy 阻断的原文。
explain 不改变状态。
explain 输出必须说明“不展示”的原因。
```

## 事件与审计

CLI 可以记录 CLI invocation 审计事件或 receipt。

事实：

```text
CLI 审计事件不替代业务模块事件。
业务状态仍由对应模块事件和 artifact 重建。
CLI 审计只记录命令入口、调用模块、结果引用、approval 回执和展示摘要。
纠错通过新的 CLIInvocationReceipt 或业务模块 superseding event 表达。
```

## 与其他模块的边界

### File-Native Store

File-Native Store 负责 workspace 定位和结构性文件安全。

CLI 只请求 workspace handle。

事实：

```text
CLI 不自己解析 path traversal、symlink escape 或原子写语义。
File Store 拒绝路径时 CLI 不能绕过。
```

### Grow Unit Manager

Grow Unit Manager 拥有 grow lifecycle。

CLI 调用其 lifecycle、coordination 和 snapshot ports。

事实：

```text
CLI 不直接写 lifecycle 文件。
CLI 不创建用户 session。
```

### Admission & Feedback Inbox

Admission & Feedback Inbox 拥有 input、material、feedback 和 upstream proposal 状态。

CLI 只提交用户输入、材料或反馈请求。

事实：

```text
命令行输入不自动进入 message list。
CLI 不直接修改 feedback status。
```

### Context & Message Compiler

Context & Message Compiler 拥有 grow compiled_message_list。

CLI 只解释或展示 message list ref。

事实：

```text
CLI 不手写 provider message list。
CLI 不把命令历史拼进模型上下文。
```

### Grow Attempt Runner

Grow Attempt Runner 拥有一次 attempt 的执行编排。

CLI 可以请求启动或运行 attempt。

事实：

```text
attempt 不是 session。
CLI 进程退出不删除 attempt trace。
```

### Evidence & Readiness

Evidence & Readiness 拥有 readiness verdict。

CLI 只展示和解释 readiness。

事实：

```text
CLI 不用用户确认替代 evidence。
CLI 不把 attempt success 当 ready_to_hatch。
```

### Hatch Builder

Hatch Builder 拥有 hatch package 构建。

CLI 调用 hatch ports 并展示 package explanation。

事实：

```text
CLI 不复制 grow 目录生成 package。
CLI 不改写 package version。
```

### Agent Runtime Kernel

Agent Runtime Kernel 运行支持 agent kernel 的 hatch package。

CLI 可以调用 runtime ports。

事实：

```text
CLI 不编译 runtime_message_list。
CLI 不把 non_llm_runtime 强制交给 Agent Runtime Kernel。
```

### Debug & Feedback Bridge

Debug & Feedback Bridge 生成反馈候选桥接包。

CLI 提供 debug 和 feedback 命令入口。

事实：

```text
CLI 不把 debug trace 直接上游。
CLI 不替 Bridge 判断 attribution。
```

### Policy & Capability Boundary

Policy & Capability Boundary 拥有 decision、approval、grant 和 boundary explanation。

CLI 提供用户交互入口。

事实：

```text
Policy ask 没有 approval 时 CLI 不能继续高风险动作。
Policy deny 或 unsupported 必须在 CLI 中显式展示。
```

## 不变量

```text
CLI 不拥有业务状态。
CLI 不直接写 grow 事实文件。
CLI 不绕过 Policy。
CLI 不创建用户可见 session。
CLI invocation 不等于 grow unit。
command history 不等于 grow memory。
用户输入必须先经过 Admission。
grow message list 只能由 Context & Message Compiler 创建。
runtime message list 只能由 Agent Runtime Kernel 创建。
ready_to_hatch 只能来自 Evidence & Readiness。
hatch_package 只能由 Hatch Builder 创建。
runtime feedback 不能绕过 Debug Bridge 和 Admission。
机器可读输出也不能泄露被 policy 或 privacy 阻断的原文。
```

## 错误行为

该模块使用 `Result<DomainError>` 表达业务失败，并把错误映射为稳定 exit status。

错误 code 至少覆盖：

```text
workspace_not_found
grow_unit_not_found
invalid_command
invalid_input
invalid_state
permission_denied
approval_required
policy_blocked
privacy_blocked
boundary_unsupported
artifact_unavailable
readiness_failed
contract_not_ready
package_unavailable
runtime_kernel_unsupported
target_world_unavailable
admission_rejected
attempt_failed
interrupted
```

事实：

```text
workspace_not_found 不会创建隐藏 workspace。
approval_required 映射为 waiting_approval。
policy_blocked 映射为 blocked_by_policy。
privacy_blocked 映射为 blocked_by_privacy。
readiness_failed 或 contract_not_ready 阻止 hatch build。
runtime_kernel_unsupported 不会退化为 prompt wrapper。
错误输出必须包含可解释 reason 和可展示 source refs。
```

## 验证要求

实现阶段应验证：

```text
status/explain 命令不会修改业务事件。
grow 命令不会绕过 Admission 直接写 message list。
grow attempt 的 MessageListRef 来自 Context & Message Compiler。
CLI 不创建 Session 类型或用户可见 session 文案。
hatch 命令没有 ready_to_hatch 和 locked contract 时失败。
hatch 命令不能复制整个 grow 目录。
runtime 命令不会用 Agent Runtime Kernel 启动 non_llm_runtime package。
debug 命令不会把 trace 直接变成 accepted feedback。
policy ask 没有 approval receipt 时命令停在 waiting_approval。
machine_readable 输出不会泄露 hiddenRefs 原文。
CLI 进程中断后，后续命令可通过 file-native projection 解释当前状态。
```

## 开放问题

```text
具体命令名、flag、别名和帮助文本属于 CLI 语法设计。
是否提供长驻后台 worker、任务队列或 watch mode 属于实现阶段宿主设计。
本地安装、自动更新和 PATH 管理属于分发设计。
target world host integration 是否 shell into feng，还是使用库 API，需要场景实现阶段确认。
```

这些问题不影响本模块当前终态事实：CLI 是本地用户入口和 port 编排层，不是业务状态中心、agent runtime、prompt 编译器、hatch builder、feedback 状态机或 session manager。

