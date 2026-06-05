# MVP：feng 自迭代设计

## 1. MVP 目标

MVP 的目标是证明：

```text
feng runtime + 当前目录 .feng 实例 + 当前 workspace
```

可以让 feng 在自己的源码仓库里迭代 feng 自己。

这不是写一个 feng 专用 agent，也不是让 Codex 手动驱动每一轮。Codex 或用户只负责启动和补信息；生命周期 loop 必须由 feng runtime 自己执行。

## 2. 目标目录

在 feng 源码仓库中：

```text
feng/
  .git/
  go.mod
  cmd/
  internal/
  docs/
  scripts/
  .feng/
    instance.yaml
    goal.md
    inbox/
    skills/
      iterate-feng.md
      review-design.md
      implement-go-runtime.md
      validate-release.md
    tools/
      go-test.tool.yaml
      go-build.tool.yaml
      feng-check.tool.yaml
      feng-hatch.tool.yaml
    prompts/
      kernel.md
      message-policy.md
      review-policy.md
    messages/
      latest.json
      token-report.json
    world/
      repo-map.md
      runtime-boundary.md
      mvp-requirements.md
    evals/
      self-check.yaml
      source-health.yaml
      portable-smoke.yaml
    state.yaml
    lock
    events.jsonl
    runs/
    artifacts/
    history/
```

`cmd/ internal/ docs/` 是被迭代对象。`.feng/` 是迭代 feng 的 agent 实例。

## 3. 自迭代 loop

用户启动：

```text
feng grow "改进 feng 的自迭代能力"
```

runtime 执行：

```text
1. 创建或读取 .feng。
2. 把用户输入写入 .feng/inbox。
3. 消化 raw intake，判断它是目标变化、世界事实、工具需求、eval 需求还是一次性证据。
4. 生成 candidate world/tools/evals/skills 更新。
5. 编译 message list 到 .feng/messages/latest.json。
6. 调 LLM。
7. 执行工具，修改 .feng 或 workspace。
8. 运行 check。
9. 如果 check 失败，记录 artifact，继续 grow 修复。
10. 如果 check 通过，checkpoint .feng 能力和必要 workspace 变更。
11. 如果目标达到，停止；需要发布时 hatch。
```

MVP 可以保留显式 `feng check` 和 `feng hatch` 命令，但不能要求外部 agent 手动执行每一轮。

目标达到不能只靠 assistant 声明。自迭代至少需要 source-health、feng check 和 portable smoke eval 覆盖当前目标；失败时进入 repair，全部通过后才允许 hatch 下一版 feng。

## 4. 必须自举的能力

`.feng/skills/iterate-feng.md` 描述如何迭代 feng：

```text
读取核心诉求和架构文档
识别实现偏差
修改 Go runtime 或 docs
运行 go test / go vet / go build
运行 feng check
运行 hatch portable smoke
把失败报告作为下一轮修复材料
```

`.feng/tools` 中只保存通用 command tool 声明，不写进 runtime 特殊分支。

```text
go-test
go-vet
go-build
feng-check
feng-hatch
portable-smoke
```

这些工具仍然经过 permission、schema、artifact 和 event。

## 5. Message 和 Token

自迭代必须遵守 token efficiency：

```text
源码和长日志不直接塞进 prompt。
docs/source index 进入 state manifest。
相关 skill/world excerpt 进入 cached context pack。
raw intake 只进入动态后缀或 artifact ref，不能当成稳定能力。
长 test output 进入 artifact。
latest message list 和 token report 写入 .feng/messages。
```

## 6. Checkpoint

MVP 需要区分：

```text
.feng instance checkpoint
  skills/tools/prompts/world/evals 的 validated 状态。

workspace source change
  cmd/internal/docs 等 feng 源码和文档的变更。
```

在 feng 自迭代场景中，workspace 本身就是 feng 源码仓库，所以 source change 可以通过仓库 Git 进入提交；但这仍然是受 check 保护的项目变更，不是 runtime 任意推进 Git。

如果新 intake 推翻旧架构理解，相关 world/skill/eval 必须标记 stale 并重跑。否则 feng 可能带着互相矛盾的设计继续 hatch。

## 7. Hatch

通过后：

```text
feng hatch --name feng --portable
```

产物：

```text
dist/feng/
  feng
  feng.cmd
  feng-runner
  self/
    skills/
    tools/
    prompts/
    world/
    evals/
    interface.yaml
    permissions.yaml
    config.schema.yaml
  provider-examples/
  feng-release.yaml
  checksums.json
```

下一版 feng 在新目录运行时，仍然创建当前目录的 `.feng/` 实例；它不把源码仓库里的 `.feng` 直接当作用户目录状态。

## 8. 非目标

MVP 不做：

```text
Codex 外部驱动每一轮。
feng 自举专用 runtime 分支。
复杂多 agent 调度。
完整 MCP transport。
自动接管用户项目 Git。
```

## 9. 成功标准

```text
1. 空目录运行 feng grow 会创建 .feng 实例。
2. feng 源码目录运行 feng grow 会用 .feng 实例迭代 cmd/internal/docs。
3. 用户补充信息会进入 inbox 并合并到当前目标。
4. message list、token report、artifacts 可观察。
5. check 失败后 feng 能读取失败 artifact 并继续修复。
6. check 通过后产生 validated checkpoint。
7. hatch 生成下一版 feng 命令。
8. 下一版 feng 在新目录仍能创建 .feng 并继续 grow。
```
