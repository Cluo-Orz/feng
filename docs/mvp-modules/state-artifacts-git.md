# MVP 模块：State, Artifacts, History and Git

## 职责

表达 `.feng` 实例的运行状态、成长历史、失败现场和可观测性。

## State

```yaml
mode: growing | checking | executing | blocked | ready | missing_config
current_goal: ""
candidate_status: none | dirty | failed | validated
validated_instance: ""
source_self_commit: ""
active_tool_pack_hash: ""
stable_prefix_hash: ""
context_pack_hash: ""
context_budget:
  max_input_tokens: 0
  estimated_input_tokens: 0
  dynamic_suffix_tokens: 0
  context_pack_tokens: 0
last_recovery:
  type: ""
  artifact: ""
recovery_count: 0
last_event_id: ""
last_artifacts: []
```

状态文件默认在：

```text
.feng/state.yaml
```

产品命令 `xiaopi` 使用：

```text
.xiaopi/state.yaml
```

## Lock

mutating 命令必须拿实例锁：

```text
.feng/lock
```

只读命令 `status/watch/artifacts/gui` 不需要拿锁。stale lock 以 heartbeat 和 PID 判断。

## Events

```text
.feng/events.jsonl
```

核心事件：

```text
run_started
run_stopped
message_compiled
tool_called
tool_result
tool_denied
artifact_written
check_failed
check_passed
validated_instance_updated
hatch_created
blocked
```

event 必须可增量读取、脱敏、压缩。长内容不能直接进入 event。

## Artifacts

```text
.feng/artifacts/
```

artifact ref：

```yaml
type: assistant-output | execute-output | tool-output | eval-output | diff | provider-error | check-report | hatch-preview
source: ""
path: ""
hash: ""
summary: ""
why_relevant: ""
snippets: []
```

长日志、完整 diff、网页正文、测试输出都写 artifact。message 只放 artifact ref。

## History

```text
.feng/history/
```

记录 agent 成长历史：

```text
user input
goal changes
skill/tool/prompt/world changes
message hashes
check reports
validated instance snapshots
```

MVP 可以先用 JSONL 和 snapshot 文件实现，不要求复杂数据库。

## Git

不要混淆两种历史：

```text
.feng/history
  agent 实例成长历史。

workspace .git
  用户项目历史，如果存在。
```

feng 可以读取 workspace Git 作为事实。是否提交 workspace 文件必须由目标、权限或用户明确决定。runtime 不默认接管用户项目 Git。

在 feng 自迭代场景中，workspace 是 feng 源码仓库；因此源码变更可以通过仓库 Git checkpoint，但 `.feng` 仍然是负责迭代的实例空间。

## Recovery

check 失败不自动丢弃 candidate。

```text
失败报告 -> artifacts
diff/日志 -> artifacts
last_recovery -> state
下一轮 grow -> 读取 artifact refs 修复
```

## 不变量

```text
失败现场是成长材料。
不能把真实 secret 写入 event/artifact/history。
不能把 .feng/cache 或本机 provider profile 打包。
不能用 workspace Git 替代 .feng 实例历史。
```
