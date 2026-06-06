# Policy & Capability Boundary Spec Round 01

## 当前草稿判断

第一版直觉是做一个中心化权限配置模块：

```text
哪些目录能读。
哪些目录能写。
哪些命令能执行。
哪些网络地址能访问。
哪些 artifact 可以发布或上报。
```

这个方向看起来简单，但它容易把 policy 写成静态配置表，无法支撑 feng 的 grow/hatch 闭环。

## 顶层视角检测

顶层模块设计要求该模块负责动作边界和权限决策，并且必须诚实表达当前实现能限制什么、不能限制什么。

调研结论反复指出：

```text
插件、hook、MCP、prompt 和权限提示不是强安全边界。
工具和权限是 agent 产品的一部分，不是实现细节。
上报不等于吸收，候选不等于合并。
高风险动作需要真实权限控制、隔离、确认、日志和可撤销策略。
```

因此，该模块不能只是配置表。它必须能回答“某个模块在某个上下文里请求某种能力，是否允许、需要确认、需要脱敏、需要约束，或者当前实现根本不支持安全执行”。

## 问题

静态权限配置存在四个问题：

```text
它容易和 File-Native Store 的路径 containment 职责冲突。
它无法表达 artifact privacy、retention、source 和 hatch publish exclusion。
它无法表达 feedback upstream、target world action、secret access 这类非文件动作。
它容易制造安全错觉，让用户以为 policy decision 等于 OS sandbox。
```

更大的风险是：如果 policy 不记录 decision 事件和证据，后续 replay、debug、hatch contract 和上游吸收都无法解释“为什么这次动作被允许或拒绝”。

## 调整

第二版改为 capability/action decision 模型：

```text
Capability 表达能力域。
ActionRequest 表达一次具体动作请求。
PolicyContext 表达 grow unit、attempt、artifact、runtime、target world、调用方和来源。
PolicyDecision 表达 allow、deny、ask、allow_with_constraints、allow_with_redaction、unsupported。
DecisionBoundary 表达这次 decision 的真实执行边界。
PolicyDecisionEvent 写入 Event Ledger。
```

File-Native Store 仍然负责结构性路径安全；Policy 负责业务动作是否允许。即使 Policy 允许，路径逃逸仍由 File Store 拒绝。

## 进入下一轮的结论

下一轮需要继续检查：

```text
policy 是否覆盖 feedback upstream 和 hatch publish。
policy 是否能利用 Artifact Registry 的 privacy metadata。
policy 是否明确调用方负责执行约束，而不是自己执行动作。
policy 是否能诚实表达 advisory、approval、host sandbox 等不同边界等级。
```
