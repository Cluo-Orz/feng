# Claude Code 借鉴 Review 第 2 轮改进方案

## 问题

第一轮补了 LLM recovery、active tool pack、cache key，但 MVP 的 state schema 没同步，导致：

```text
missing_config mode 在恢复规则中出现，但 state mode 没定义。
active_tool_pack_hash 写入 events，但 state 快照不体现。
token/cache/recovery 指标没有 status 入口。
```

## 修复

### 1. 扩展 MVP state.yaml 最小字段

在 `mvp-self-iteration-design.md` 中把 state 改成：

```text
mode: growing | checking | blocked | ready | missing_config
active_tool_pack_hash
stable_prefix_hash
context_budget
last_recovery
recovery_count
```

### 2. 同步 module state 文档

在 `state-artifacts-git.md` 中补齐同样字段和含义。

### 3. 不引入新系统

这些字段只是现有 events/artifacts 的快照索引，不新增任务系统、后台系统或 provider router。

## Review 标准

修复后检查：

```text
missing_config 是否只有一种语义。
status 是否能解释 blocked/recovery/cache 相关状态。
是否重新引入复杂 session/resume。
是否有预置项目 skill。
```
