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

## 输入合并

每次 `feng grow "..."` 都先写入：

```text
.feng/inbox/<timestamp>.md
```

然后由 runtime 和 LLM 结合当前 `.feng/goal.md`、world、skills、history 判断如何合并。用户补充信息不是一次孤立任务。

## 默认能力

默认实例只包含最小工具说明和空能力目录。

```text
.feng/skills/ 可以为空。
.feng/world/ 可以为空。
.feng/prompts/ 只包含最小 kernel/message 规则。
.feng/tools/ 只描述 read_file/write_file/list_files/run_command。
```

不要预置项目 skill。第一个 grow 通过通用 loop 长出 candidate skills/world/evals/tools。

## Package Seed

如果命令来自 hatch package，runtime 读取安装包里的 `self/` 作为稳定能力种子，但仍在当前目录创建运行实例。

```text
package/self     stable packaged ability
workspace/.name  local runtime state
```

对于默认 feng 命令，实例目录是 `.feng/`。对于产品命令 `xiaopi`，实例目录默认是 `.xiaopi/`。

## 不变量

```text
feng binary 不保存实例能力。
workspace 根不散落 skills/tools/world。
.feng 是当前目录 agent 实例。
template/seed 只能补缺失实例文件，不能覆盖用户 workspace。
```
