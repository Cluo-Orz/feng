# MVP Review 第 4 轮推演报告

## 1. 本轮目标

对 MVP 自迭代设计做 G01-G10 全量收敛检查。

## 2. G01 通用性

状态：满足。

依据：

```text
没有 fengsmith。
没有 if project == feng。
没有自举专用 runtime。
init-self 已明确为通用命令。
自举只是通用 workspace 的一个使用场景。
```

## 3. G02 自迭代闭环

状态：满足。

闭环：

```text
init-self
grow
check
validated_commit
hatch --name feng --portable
new feng init-self/grow/check/hatch
```

## 4. G03 文件即自我

状态：满足。

MVP self repo 覆盖：

```text
identity.md
goal.md
skills/
hooks.yaml
tools/
world/
evals/
interface.yaml
permissions.yaml
config.schema.yaml
feng.yaml
```

## 5. G04 LLM 和工具

状态：满足。

MVP 设计包含：

```text
provider-neutral LLM 调用层
openai_chat adapter
Anthropic adapter interface
DeepSeek provider profile
bootstrap tools
ToolCall / ToolResult
permission check
```

## 6. G05 Token efficiency

状态：满足。

MVP 设计包含：

```text
stable prefix
dynamic suffix
artifact refs
active tool pack
tool response 文件化
assistant 不保存长推理
```

## 7. G06 Git 成长

状态：满足。

MVP 设计包含：

```text
validated commit
working tree candidate
tag
check 失败不更新 validated_commit
失败现场进入 artifacts
下一轮修复 candidate
```

## 8. G07 Check

状态：满足。

MVP check 覆盖：

```text
self load
schema parse
hooks parse
permissions parse
tools load
message compiler
provider profile parse
evals
禁止特殊 runtime
case-first review
secret check
dangerous git command check
```

## 9. G08 Hatch

状态：满足。

MVP hatch：

```text
只从 validated_commit 打包
输出 named command feng
包含 self、runner、manifest、checksums、provider examples
不包含 API key、本机 provider profile、cache、runs、失败 candidate
```

## 10. G09 可观测性

状态：满足。

MVP 可观测：

```text
.feng/state.yaml
.feng/events.jsonl
.feng/artifacts/
status
watch
artifacts
只读 GUI
```

## 11. G10 简单性

状态：满足。

MVP 仍保持：

```text
Runtime Kernel
Self Repo
.feng State
Git
```

没有引入复杂系统。

## 12. 剩余实现期问题

这些不是设计缺口：

```text
具体语言和目录结构
YAML schema 定义
ProviderProfile parser
OpenAI adapter 代码
Tool dispatcher 代码
Permission matcher
Git command wrapper
Hatch 打包脚本
GUI 页面实现
测试 fixture
```

## 13. 本轮结论

MVP 自迭代设计已经是当前架构设计的可行落地方案。

不建议继续扩写 MVP 概念文档。

下一步应进入：

```text
实现规格
或最小代码原型
```
