# Policy & Capability Boundary Spec Round 02

## 当前草稿判断

第二版已经从静态配置转向 capability/action decision，但仍有过度中心化风险。

如果所有模块都把任何判断塞给 Policy，这个模块会变成“业务总裁判”，反而破坏顶层模块设计的所有权边界。

## 顶层视角检测

顶层设计里的所有权边界是：

```text
File-Native Store 拥有路径 containment 和原子文件操作。
Artifact Registry 拥有 artifact metadata、privacy、lifecycle 和 materialization。
Admission & Feedback Inbox 拥有输入和反馈准入状态。
Hatch Builder 拥有 hatch package 内容选择和构建。
Tool Runtime 拥有工具执行和结果归档。
Agent Runtime Kernel 拥有 hatch agent 的运行 trace。
```

Policy 不能替这些模块做业务决策。它应该只对“请求的动作是否越界”做统一判断，并把判断依据写下来。

## 问题

第二版还缺少三类关键事实：

```text
真实边界声明：decision 是否只是 advisory，是否依赖人工 approval，是否依赖 host sandbox，是否无法保证。
隐私和发布边界：artifact export、feedback upstream、hatch publish 必须显式读取 privacy/source/retention，而不是靠调用方口头遵守。
grant 和撤销：一次 approval 不能无限期变成永久能力，必须有作用域、有效期、原因和撤销状态。
```

还有一个设计误区：把 redaction 当成 Artifact Registry 的内部行为。Artifact Registry 可以保存 redacted 状态和预览，但“这次上报/发布需要不需要脱敏、脱敏后是否还允许”属于 policy decision。

## 调整

第三版保留 capability/action decision，但明确职责边界：

```text
Policy 不读取 arbitrary file content，只读取必要 metadata、contract summary 和 artifact record。
Policy 不执行工具、不写文件、不发网络请求、不发布 hatch 包。
Policy 输出 decision、constraints、requiredApproval、redactionRequirement、boundaryDeclaration。
调用方必须按 decision 执行动作，并把执行结果写入自己的模块事件或 artifact。
Policy 自己只写 policy decision / grant / revoke / approval 相关事件。
```

Capability 域扩展为：

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

Decision 增加真实边界等级：

```text
structural_guard
policy_decision
human_approval
host_sandbox_required
external_enforcement
advisory_only
unsupported
```

## 进入下一轮的结论

下一轮需要将 spec 收敛为最终事实，并特别检查：

```text
是否避免了与 Artifact Registry、File Store、Hatch Builder 的职责重叠。
是否让高风险动作都有可审计 decision。
是否保留用户心智简单，不把 policy 暴露成复杂产品表面。
是否能支撑 feng -> xiaoshuo -> libai 的多层上报隐私边界。
```
