# feng 核心诉求

## 1. 核心产品诉求

feng 要成为一个独立命令。它在任意目录运行时，都能让这个目录获得一个可成长的 agent 实例。

```text
feng command
  通用 runtime。

.feng/
  当前目录里的 agent 实例。

workspace files
  用户真正要处理的项目、数据、代码和环境。
```

用户只需要表达目标和反馈：

```text
feng grow "我要做什么"
feng grow "补充一个事实"
feng grow "按这个反馈继续"
```

feng 负责合并信息、维护长期目标、选择工具、编排上下文、调用 LLM、修改 workspace、验证结果和继续运行。

## 2. 必须成立的体验

### 空目录

```text
mkdir demo
cd demo
feng grow "做一个能汇总新闻的 agent"
```

结果：

```text
demo/
  .feng/
    goal.md
    inbox/
    skills/
    tools/
    prompts/
    messages/
    world/
    evals/
    state.yaml
    events.jsonl
    artifacts/
```

`.feng` 是实例空间，不污染用户项目根目录。

### 普通项目目录

```text
cd existing-project
feng grow "帮我实现 API 测试"
```

feng 在当前目录创建/读取 `.feng`，按权限修改 `existing-project` 的项目文件。它不会把 `skills/ tools/ world/` 散落到项目根目录。

### feng 自迭代

```text
cd feng
feng grow "改进 feng 自己的自迭代能力"
```

这里：

```text
cmd/ internal/ docs/
  被修改的 feng 源码和文档。

.feng/
  如何迭代 feng 的 skills、tools、prompts、world、evals、history。
```

自迭代不能依赖 Codex 手动串联每一轮。Codex 或用户只负责补信息；feng runtime 必须能自己执行 grow/check/repair/check 的闭环。

### hatch 后产品

创造者：

```text
feng hatch --name xiaopi --portable
```

使用者：

```text
cd ~/Downloads
xiaopi "整理发票"
```

安装包里有 frozen self：

```text
xiaopi-package/
  xiaopi
  feng-runner
  self/
    skills/
    tools/
    prompts/
    world/
    evals/
```

用户目录里只有运行态：

```text
~/Downloads/
  .xiaopi/
    state.yaml
    events.jsonl
    runs/
    artifacts/
    history/
    config.yaml
```

## 3. 核心架构要求

```text
Runtime 必须稳定、薄、通用。
.feng 必须是一等实例根。
skills/tools/prompts/world/evals 必须属于实例或 packaged self。
workspace 必须保持用户项目语义。
世界输入可以是任意格式，但稳定能力必须沉淀到 world/tools/skills/evals。
message list 必须由 runtime 临时编译，不是长期记忆。
长内容必须文件化。
工具调用必须经过权限。
check 失败不能丢 candidate。
validated 能力必须可 checkpoint。
hatch 产物必须是普通命令。
done 必须由 eval/check 证明，不能只看 assistant 文本。
hatch 必须打包 validated ability closure，不打包完整 .feng。
外来 .feng 默认 untrusted。
```

## 4. World Intake 要求

用户“告诉 feng 如何感知世界”时，不需要遵守固定 schema。

允许输入：

```text
自然语言
文件路径
API 文档
curl 示例
SDK 说明
日志
网页
设备协议
代码仓库
截图或其他 artifact 引用
```

feng 必须把这些 raw intake 逐步整理成：

```text
.feng/world
  当前稳定世界理解。

.feng/tools
  感知或操作世界的工具。

.feng/evals
  证明目标是否满足的检查。

.feng/skills
  如何使用 world/tools/evals 完成目标。
```

判断一项世界信息是否真正被吸收，不看它是否填了某个表，而看它是否已经变成：

```text
可感知
可行动
可约束
可验证
可复用
```

如果只停留在 inbox 或 artifact 里，它还只是材料，不是能力。

用户后续输入可以修订旧理解。发生冲突时，feng 必须标记受影响能力 stale，重跑相关 eval，通过后才更新 validated 能力。

## 5. Context Engineering 要求

唯一核心指标是 token efficiency。

```text
稳定的放前面。
动态的放后面。
大内容放文件。
prompt 里尽量放引用。
tool schema 只暴露 active subset。
assistant/tool 历史只保留必要短后缀。
```

每轮 message list 至少分层：

```text
provider tools
system: kernel rules
system: instance summary
optional cached context pack
user: state manifest
conversation suffix
user: latest user input or event
```

`.feng/messages` 要记录：

```text
latest message list
stable_prefix_hash
active_tool_pack_hash
context_pack_hash
estimated tokens
provider usage
cache hit/miss
compaction events
```

## 6. Tools 要求

初始工具只有：

```text
read_file
write_file
list_files
run_command
```

工具定义和工具说明进入 `.feng/tools` 或 packaged `self/tools`。后续工具必须通过 schema、permission 和 check。MCP 不是 MVP 工具实现，只能作为未来 adapter 接入内部 `Tool / ToolCall / ToolResult`。

## 7. Git 和历史要求

feng 需要两类历史，不要混淆：

```text
.feng/history
  agent 实例的成长历史。

workspace Git
  用户项目自己的版本历史，如果存在。
```

feng 可以读取 workspace Git，但不能默认接管它。对 `.feng` 能力文件的 checkpoint 是 agent 成长语义；对用户项目文件的提交是用户项目语义，必须由目标、权限或用户确认明确触发。

## 8. 简单性要求

不要把 feng 做成复杂框架。

```text
一个命令
一个 .feng 实例根
一个 loop
一套工具协议
一套 message compiler
一套状态和 artifact 机制
```

所有复杂能力都应该长在 `.feng/skills`、`.feng/tools`、`.feng/prompts` 和 `.feng/evals` 中，而不是写死进 runtime。

外来 `.feng` 中的工具不是天然可信。未确认信任前，feng 只能 inspect/check，不能执行实例自带 command tool 或写 workspace。

## 9. 最终判断

feng 的核心不是“agent 做一次任务”，而是：

```text
让任意目录拥有一个能被持续喂养、能自我组织、能调用工具、能验证结果、能 hatch 成产品命令的 agent 实例。
```
