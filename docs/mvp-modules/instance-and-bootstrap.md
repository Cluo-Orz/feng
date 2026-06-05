# MVP 模块：Instance and Bootstrap

## 职责

在当前目录创建或读取 `.feng/` agent 实例。

## 首次 grow

```text
cd any-workspace
feng grow "目标"
```

如果 `.feng/` 不存在，runtime 创建最小实例：

```text
.feng/
  instance.yaml
  goal.md
  inbox/
  skills/
  tools/
  prompts/
  messages/
  world/
  evals/
  permissions.yaml
  config.schema.yaml
  state.yaml
  lock
  events.jsonl
  runs/
  artifacts/
  history/
```

已有 workspace 文件不移动、不覆盖。它们是当前世界，不是 feng 的 self 文件。

## World Intake

每次 `feng grow "..."` 都先写入：

```text
.feng/inbox/<timestamp>.md
```

inbox 只保存 raw intake。它可以是任意形式：

```text
用户自然语言
文件路径
API 文档
设备说明
日志
网页正文 artifact
代码片段
纠错反馈
```

raw intake 不是稳定能力。feng 下一步必须判断它应该沉淀到哪里：

```text
goal.md
  长期目标或目标变更。

world/
  对世界的稳定理解。

tools/
  感知或操作世界的工具。

evals/
  判断目标是否达成的检查。

skills/
  如何使用 world/tools/evals 完成目标。

artifacts/
  长证据或一次性证据。
```

用户补充信息不是一次孤立任务；它会进入同一个实例的 intake 流，经过 grow/check 后才可能成为稳定能力。

每条 raw intake 有明确状态：

```text
new         未处理。
digested    已沉淀到 goal/world/tools/evals/skills/artifacts。
superseded  被后续输入取代。
rejected    与目标无关或不可信。
needs_user  关键信息不足，需要用户补充。
```

如果新输入推翻旧理解，feng 不是简单覆盖文件，而是记录 revision event，标记受影响的 world/tool/skill/eval 为 stale，并重新跑相关 eval。只有 check 通过后，新的理解才会进入 validated instance。

## 默认能力

默认实例只包含最小工具说明和空能力目录。

```text
.feng/skills/ 可以为空。
.feng/world/ 可以为空。
.feng/prompts/ 只包含最小 kernel/message 规则。
.feng/tools/ 只描述 read_file/write_file/list_files/run_command。
```

不要预置项目 skill。第一个 grow 通过通用 loop 长出 candidate world/tools/evals/skills。不要要求用户一开始提供固定格式的世界描述。

## Package Seed

如果命令来自 hatch package，runtime 读取安装包里的 `self/` 作为稳定能力种子，但仍在当前目录创建运行实例。

```text
package/self     stable packaged ability
workspace/.name  local runtime state
```

对于默认 feng 命令，实例目录是 `.feng/`。对于产品命令 `xiaopi`，实例目录默认是 `.xiaopi/`。

## Trust Gate

当前 runtime 创建的新实例默认 trusted。来自 clone、下载、复制或 package 展开的外部 `.feng` 默认 untrusted，直到用户明确确认。

untrusted 实例可以被读取、展示、check，但不能：

```text
执行 .feng/tools 里的 command tool
写 workspace
hatch/package
扩大 permissions
```

这个限制属于 runtime 边界，不依赖 prompt 约束。

## 不变量

```text
feng binary 不保存实例能力。
workspace 根不散落 skills/tools/world。
.feng 是当前目录 agent 实例。
runtime seed 或 package seed 只能补缺失实例文件，不能覆盖用户 workspace。
inbox 是材料，不是能力。
稳定能力必须能被工具感知、权限约束、eval 验证，并被 skill 复用。
外部带来的实例先验证和确认，再执行。
```
