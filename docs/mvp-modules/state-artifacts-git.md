# MVP 模块：State, Artifacts and Git

## 职责

这个模块表达 feng 长任务的生命体征和 self 的代际成长。

## .feng State

```yaml
mode: growing | checking | blocked | ready | missing_config
current_goal: ""
validated_commit: ""
source_self_commit: ""
candidate_status: none | dirty | failed | validated
active_tool_pack_hash: ""
stable_prefix_hash: ""
context_budget:
  max_input_tokens: 0
  estimated_input_tokens: 0
  dynamic_suffix_tokens: 0
last_recovery:
  type: ""
  artifact: ""
recovery_count: 0
last_event_id: ""
last_artifacts: []
lock:
  owner: ""
  heartbeat: ""
```

Go runtime 使用 `.feng/lock` 表示 workspace 修改锁。`grow`、`check`、`hatch` 这类会修改 workspace 的命令必须先拿锁；`status/watch/artifacts/gui` 只读命令不需要拿锁。

拿到锁的进程会持续刷新 `.feng/lock` 和 `.feng/state.yaml` 里的 heartbeat。stale lock 判断以 heartbeat 为准，而不是只看 lock 文件 mtime，避免长任务运行中被误判为失效。

`last_recovery` 表示当前需要用户或下一轮 grow 关注的最近恢复状态。check 失败时它指向 check report artifact；provider 失败时它指向 provider-error artifact。成功的 grow 或 check 会清空它；`recovery_count` 保留为累计计数，避免 status/gui 在 ready 状态下继续展示旧错误。

`check_failed` recovery 不会因为下一轮 grow 只生成计划而清空。只要 candidate 仍然是 failed 或 dirty，last_recovery 继续指向最近的 check report；新的 plan 可以作为 `assistant-output` 进入 last_artifacts。只有 check 通过、或出现新的 provider/config recovery，才替换这条恢复指针。

`candidate_status` 由 self roots 的 Git 状态驱动。`grow` 开始、provider 缺配置、只读工具调用或 assistant 只输出计划，都不能单独把 validated self 标记为 dirty；只有 self roots 出现未验证变化时才进入 dirty。这样一次失败的 grow 不会让仍然干净的 validated self 无法 tag/hatch。

## Events

`.feng/events.jsonl` 是 append-only：

```text
run_started
message_compiled
tool_called
tool_denied
tool_result
artifact_written
provider_recovered
provider_recovery
check_failed
check_passed
validated_commit_updated
hatch_created
blocked
```

每条 event 必须有唯一 `id`，用于 `status/watch/gui` 把 running、progress 和 artifact 变化串起来。MVP 使用时间戳加进程内序号即可，不需要引入外部事件系统。

`tool_called` 在 dispatcher 开始执行工具前写入，用于让 `watch/gui` 观察长命令已经启动；参数必须压缩和脱敏，不能把 `write_file` content 或长 JSON 全量写进 event。`tool_result` 在工具结束后写入。`tool_denied` 必须指向 `permission-denied` artifact，让下一轮 grow 可以通过 artifact refs 读取拒绝原因。

## Artifacts

大内容写入 `.feng/artifacts/`：

```yaml
type: assistant-output | tool-output | eval-output | test-log | diff | provider-error | check-report | hatch-preview
source: ""
path: ""
hash: ""
summary: ""
why_relevant: ""
snippets: []
```

`assistant-output` 用来保存 grow 中没有 tool call 的 assistant 计划或结论。它不是长期记忆，也不是 validated self；它只是下一轮 grow 可以通过 artifact refs 读取的进展材料。

events 和 artifacts 写盘前必须做 secret-like redaction。它们用于恢复和观测，不用于保存真实密钥。

artifact 内容文件和 metadata 文件分开：内容文件保存原始摘要材料，metadata 文件保存 `type/path/hash/summary/why_relevant/snippets`。`feng artifacts`、GUI 和 context assembly 只读取合法 metadata，不能把内容 JSON 误当成 artifact 记录。

## Git 语义

```text
validated commit = 可以启动的一版 self
working tree = candidate self + 当前 workspace 的其他用户文件
tag = 可 hatch 的命名版本
```

Git 成长边界不是整个 workspace，而是 self roots：

```text
identity.md / goal.md / feng.yaml / hooks.yaml / permissions.yaml / interface.yaml / config.schema.yaml
skills/ / tools/ / world/ / evals/
docs/ / cmd/ / internal/ / pkg/ / scripts/
Go module files
```

`check` 创建 checkpoint commit 时只 stage 这些 roots；`tag` 和 `hatch` 也只要求这些 roots 干净。workspace 里的无关用户文件、临时目录或目标环境文件可以被 agent 感知，但不能被 kernel 误提交，也不能阻塞 validated self 打包。

check 失败不强制回滚。下一轮 grow 从 validated self 启动，读取 self roots 的 diff 和 artifacts 修复 candidate。

如果 workspace 是从 hatch package bootstrap 出来的，`source_self_commit` 记录 package manifest 中的 frozen self commit。它只表达来源，不代替本地 Git 的 `validated_commit`；新 workspace 仍然需要通过自己的 `check` 生成本地 validated checkpoint。

## 不变量

```text
失败现场是成长材料。
不能自动丢弃 candidate。
不能把 .feng/cache 和本机 provider profile 打包。
不能把真实 secret 写入 artifact。
```
