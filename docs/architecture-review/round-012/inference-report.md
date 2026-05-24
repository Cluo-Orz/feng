# 第 12 轮推演报告

## 1. 本轮目的

本轮继续遵守 case-first。

目标是检查第 11 轮每个 case 中是否都依赖某个架构隐含前提。如果同一个隐含前提在多个 case 中重复出现，就判断它是否需要进入 `docs/architecture.md`。

## 2. Case：Coding Agent

### 2.1 观察

Coding case 中 active tool pack 包含：

```text
read_file
write_file
list_files
run_command
可能的 test_runner / git_diff
```

如果工具越来越多，coder 不应该每轮都暴露所有工具 schema。否则 test/debug 任务会被无关 API、新闻、小车工具污染。

### 2.2 结论

需要一个简单规则：

```text
bootstrap tools 常驻。
领域工具由当前 hook/skill 选择。
工具说明全文留在 tools/ 文件。
message 只放可调用 schema。
```

这个规则帮助满足：

```text
R03 自造工具
R04 Token Efficiency
R06 Message 编排
R09 初始工具
```

## 3. Case：API Testing Agent

### 3.1 观察

API case 需要 http_request、openapi_case_runner、schema_assert。

但在只做 spec 解析时，不一定需要真实 HTTP 工具；在只生成报告时，也不需要暴露所有请求工具。

### 3.2 结论

active tool pack 必须跟随当前 skill/hook，而不是全局工具列表。

否则：

```text
工具 schema token 变高
模型可能误用无关工具
权限摘要也会变复杂
```

## 4. Case：汇总新闻 Agent

### 4.1 观察

新闻 case 可能有 rss_fetch、web_fetch、article_extract。

如果本轮只是对已有 artifact 做摘要，不需要 web_fetch。

### 4.2 结论

工具选择应保持简单：

```text
当前 skill 需要抓取，才暴露 fetch 工具。
当前 skill 只做摘要，暴露 read_file/write_file 即可。
```

这避免为新闻场景引入复杂 crawler/runtime。

## 5. Case：小车 Agent

### 5.1 观察

小车 case 中工具有明显风险等级：

```text
sensor_read
simulator_step
motor_control
stop
```

并不是所有工具都应该每轮暴露。比如 calibrate 阶段不应默认暴露高速控制。

### 5.2 结论

active tool pack 不只是省 token，也支持权限边界清晰。

但规则仍应简单：

```text
bootstrap tools 常驻。
当前 skill 需要的领域工具进入 active tool pack。
每个 tool call 仍必须过 permissions。
```

## 6. Case：Windows 桌面助手 Agent

### 6.1 观察

桌面助手可能有 file_plan、safe_move、windows_search。

`find` 请求不需要 safe_move；`dry-run organize` 不需要执行移动工具。

### 6.2 结论

active tool pack 可以降低误操作概率。

但不能把权限安全完全交给 tool selection：

```text
即使工具被暴露，也必须经过 permission check。
```

## 7. Case：Claude Code 会话管理 Agent

### 7.1 观察

ccmanage 默认不应该修改业务代码。

它可能需要 git_snapshot、session_reader、handoff_writer，但不需要 write_file 到业务源码。

### 7.2 结论

active tool pack 能表达“当前任务的可行动作集合”。

这让：

```text
summarize
handoff
next
```

各自拥有更小、更稳定的工具 schema。

## 8. Case：Feng 自举

### 8.1 观察

feng 自举时，工具会不断增长：

```text
read/write/list/run_command
Git helper
doc checker
adapter test runner
package builder
```

如果每轮都暴露全部工具，自举 context 会迅速膨胀。

### 8.2 结论

自举必须依赖 active tool pack，否则 token efficiency 会被工具 schema 打破。

但不能引入复杂 tool router，因为这会违背简单性。

## 9. 本轮客观结论

第 11 轮 case-first 推演暴露了一个共性表达缺口：

```text
architecture.md 提到了 active tool pack，但没有写最简单的选择规则。
```

已将规则补入架构文档：

```text
bootstrap tools 常驻。
领域工具由当前 hook/skill 选择。
工具多时只暴露本轮需要的工具 schema。
工具说明全文留在 tools/ 文件中。
每次 tool call 仍经过 permissions。
```

这是架构表达补强，不是新增复杂模块。
