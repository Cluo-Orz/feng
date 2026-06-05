# MVP 模块：Growth Validation

## 职责

这个模块回答四个问题：

```text
什么时候算完成？
哪些能力可以被 hatch？
用户新输入如何修订旧理解？
当前 .feng 是否可信？
```

## Done Criteria

`grow` 不能只因为 LLM 输出“完成了”就停止。一个目标进入 done 至少需要满足：

```text
goal
  当前目标已经写入 goal 或 run state。

world intake digested
  与目标相关的 raw intake 已经被归类为 world/tool/eval/skill/artifact，或明确标记为暂不使用。

eval coverage
  至少有一个 eval 或 check 明确覆盖目标的成功标准。

eval pass
  覆盖目标的 eval/check 通过。

ability closure valid
  要发布的 skill 依赖的 tools/world/prompts/evals 都存在、可加载、受 permission 约束。
```

如果目标高风险，例如硬件控制、真实文件删除、外部网络写操作，done 还必须包含：

```text
dry-run 或 simulator eval 通过。
危险动作默认不可执行，除非 permission 和用户确认明确允许。
失败时有 emergency / rollback / no-op 路径。
```

## Ability Closure

一个可 hatch 的能力不是单个 skill 文件，而是一组依赖闭包。

```text
skill
  描述何时使用、目标、输入、输出和检查。

tools
  skill 需要暴露给 LLM 的工具。

world
  skill 依赖的稳定世界理解。

prompts
  skill 需要的 prompt/message 编排规则。

evals
  证明 skill 可用的检查。

permissions
  tools 能接触的文件、命令、网络和设备边界。
```

hatch 只能打包 validated ability closure：

```text
include:
  closure 内的 skills/tools/world/prompts/evals/interface/permissions/config schema

exclude:
  inbox
  messages
  runs
  artifacts
  local history
  provider profile
  secret
  未通过 eval 的候选能力
```

如果一个 skill 声明了 tool，但 tool 没有 eval 覆盖，或者 permission 不允许它执行，closure 无效，不能进入 package self。

## Intake Revision

用户输入是持续流，不是一次性 prompt。raw intake 的状态至少有：

```text
new
  新收到，尚未处理。

digested
  已经沉淀到 world/tools/evals/skills 或 artifacts。

superseded
  被后续输入覆盖。

rejected
  不可信、不可执行或与目标无关。

needs_user
  信息不足，必须等用户补充或确认。
```

当新 intake 与已 validated 能力冲突时：

```text
1. 记录 revision event。
2. 标记受影响的 world/tool/skill/eval 为 stale。
3. 找出受影响的 ability closure。
4. 重跑相关 eval。
5. eval 通过后才更新 validated instance。
```

示例：

```text
用户先说 base_url=A，后来改成 base_url=B。
-> 旧 world/api-env.md 标记 superseded 或更新 revision。
-> 相关 API eval 必须重跑。
-> 通过后新的 base_url 语义才算稳定。
```

## Trust Gate

`.feng` 可以包含可执行工具，因此不能把任意目录里的 `.feng` 默认当作可信能力。

实例有信任状态：

```text
trusted
  本机创建，或用户确认信任。

untrusted
  来自 clone/download/copy 的未知 .feng。

packaged
  来自 hatch package self，并通过 checksums 验证。
```

untrusted 实例限制：

```text
可以读取 .feng 文件。
可以列出待执行工具和权限。
可以运行 schema/check 的只读部分。
不能执行 .feng/tools 里的 command tool。
不能写 workspace 文件。
不能 hatch。
```

用户确认信任后，runtime 写入 `.feng/instance.yaml`：

```yaml
trust: trusted
trusted_at: "..."
trusted_by: "local-user"
```

MVP 可以先用显式命令或首次 mutating grow 的确认流程实现；但设计上必须保留这个 gate，否则“clone 仓库后运行 feng grow”会变成执行陌生工具的安全风险。

## 不变量

```text
raw intake 不是稳定能力。
done 必须由 eval/check 证明。
hatch 打包 ability closure，不打包完整 .feng。
外来 .feng 默认 untrusted。
高风险世界先 dry-run/simulator，再允许真实动作。
```
