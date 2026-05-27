# MVP 模块：State, Artifacts and Git

## 职责

这个模块表达 feng 长任务的生命体征和 self 的代际成长。

## .feng State

```yaml
mode: growing | checking | blocked | ready | missing_config
current_goal: ""
validated_commit: ""
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

Go runtime 和 Python 行为原型使用同一个 `.feng/lock` 文件格式。`grow`、`check`、`hatch` 这类会修改 workspace 的命令必须先拿锁；`status/watch/artifacts/gui` 只读命令不需要拿锁。

## Events

`.feng/events.jsonl` 是 append-only：

```text
run_started
message_compiled
tool_called
tool_denied
artifact_written
provider_recovered
check_failed
check_passed
validated_commit_updated
hatch_created
blocked
```

## Artifacts

大内容写入 `.feng/artifacts/`：

```yaml
type: test-log | diff | provider-error | check-report | hatch-preview
source: ""
path: ""
hash: ""
summary: ""
why_relevant: ""
snippets: []
```

events 和 artifacts 写盘前必须做 secret-like redaction。它们用于恢复和观测，不用于保存真实密钥。

## Git 语义

```text
validated commit = 可以启动的一版 self
working tree = candidate self
tag = 可 hatch 的命名版本
```

check 失败不强制回滚。下一轮 grow 从 validated self 启动，读取 working tree diff 和 artifacts 修复 candidate。

## 不变量

```text
失败现场是成长材料。
不能自动丢弃 candidate。
不能把 .feng/cache 和本机 provider profile 打包。
不能把真实 secret 写入 artifact。
```
