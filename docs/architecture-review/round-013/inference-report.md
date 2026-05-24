# 第 13 轮推演报告

## 1. 本轮目的

本轮继续 case-first，检查每个 case 是否都需要同一组 artifact ref 最小字段。

背景：

```text
第 7 轮确立大内容文件化。
第 11 轮每个 case 都依赖 artifact refs。
但 artifact ref 如果只有路径、hash、摘要，可能不足以让 LLM 判断“要不要读这个文件”。
```

## 2. Case：Coding Agent

### 2.1 需要的 artifact refs

Coding case 会产生：

```text
test log
git diff
build output
large source file
```

如果 ref 只有 path/hash/summary，LLM 仍可能不知道：

```text
这是测试失败还是构建失败
来自哪条命令
为什么和当前修复有关
```

### 2.2 最小字段

需要：

```text
type: test-log | diff | build-output | source
source: pytest / npm test / git diff / file path
path
hash
summary
why_relevant
snippets
```

## 3. Case：API Testing Agent

### 3.1 需要的 artifact refs

API case 会产生：

```text
openapi spec
request/response log
schema mismatch report
auth failure report
```

LLM 需要知道 artifact 是 spec、响应还是断言失败，才能决定是否读取全文。

### 3.2 最小字段

需要：

```text
type: api-spec | http-response | schema-error | auth-error
source: endpoint / mock server / user spec
path
hash
summary
why_relevant
snippets
```

## 4. Case：汇总新闻 Agent

### 4.1 需要的 artifact refs

新闻 case 会产生：

```text
article html
article text
source list
dedupe report
summary draft
```

如果没有 type/source，LLM 很难区分“原文证据”和“已经生成的摘要”。

### 4.2 最小字段

需要：

```text
type: article | source-list | dedupe-report | summary-draft
source: url / rss feed / local file
path
hash
summary
why_relevant
snippets
```

## 5. Case：小车 Agent

### 5.1 需要的 artifact refs

小车 case 会产生：

```text
sensor log
camera frame
simulation trace
control decision report
safety stop report
```

这里 `why_relevant` 很重要，因为安全规则要知道这个 artifact 影响的是避障、校准还是停止。

### 5.2 最小字段

需要：

```text
type: sensor-log | camera-frame | simulation-trace | control-report | safety-stop
source: sensor id / simulator / tool call
path
hash
summary
why_relevant
snippets
```

## 6. Case：Windows 桌面助手 Agent

### 6.1 需要的 artifact refs

桌面助手会产生：

```text
file listing
operation plan
dry-run report
execution report
PowerShell output
```

LLM 需要区分计划和执行结果，否则可能把 dry-run 当成已执行。

### 6.2 最小字段

需要：

```text
type: file-listing | operation-plan | dry-run | execution-report | command-output
source: directory / tool call / command
path
hash
summary
why_relevant
snippets
```

## 7. Case：Claude Code 会话管理 Agent

### 7.1 需要的 artifact refs

会话管理会产生：

```text
session log
git diff
handoff draft
task summary
risk report
```

LLM 需要知道 artifact 是“证据”还是“产物草稿”。

### 7.2 最小字段

需要：

```text
type: session-log | diff | handoff-draft | task-summary | risk-report
source: local session / git / generated artifact
path
hash
summary
why_relevant
snippets
```

## 8. Case：Feng 自举

### 8.1 需要的 artifact refs

feng 自举会产生：

```text
round report
improvement notes
architecture diff
check output
self-hatch preview
```

如果没有 type/source/why_relevant，下一轮很难判断应该读哪一轮报告，还是读当前 diff。

### 8.2 最小字段

需要：

```text
type: round-report | improvement-notes | architecture-diff | check-output | hatch-preview
source: round id / git / command / user request
path
hash
summary
why_relevant
snippets
```

## 9. 本轮客观结论

七个 case 都说明 artifact ref 不应只是“文件地址”。

最小概念字段应是：

```text
type
source
path
hash
summary
why_relevant
snippets
```

已补入：

```text
docs/core-requirements.md
docs/architecture.md
```

这不是复杂 artifact 系统，只是 message list 中引用大内容时需要的最小语义。
