# Claude Code 借鉴 Review 第 1 轮：MVP 自迭代推演

## 1. 起点

在 feng 仓库中执行：

```text
feng grow "根据核心诉求和架构文档改进 feng 自己"
```

如果当前目录缺少 feng workspace 文件，grow 只补齐最小 self repo、`.feng/` 和 Git 成长语义。`skills/` 为空，不生成预设读取需求、架构 review、编辑 self、修复 candidate 的四个 skill。

## 2. 第一轮 seed loop

kernel 读取：

```text
self repo index
.feng/state.yaml
Git status/diff/log 摘要
docs/core-requirements.md
docs/architecture.md
docs/mvp-self-iteration-design.md
docs/llm-provider-research.md
docs/agent-expectations/*
```

message compiler 组装：

```text
provider tools
system: kernel contract
system: self contract
optional cached context pack
user: state manifest
conversation suffix
user: latest event
```

如果长文档超出预算，原文进入 artifact，message 只保留路径、hash、摘要、为什么相关和关键片段。

## 3. 生成 candidate

LLM 通过通用工具读取文件、列目录、写文档、运行受限命令，生成 candidate 修改：

```text
更新架构文档
更新 MVP 文档
更新 LLM/provider 文档
生成模块详细设计文档
生成推演报告和改进方案
```

这些能力不是模板预置 skill，而是本次 grow 的 candidate 结果。后续如果沉淀为 skill，也必须由 check 验证后进入 validated self。

## 4. Check

check 至少验证：

```text
self repo 能加载
YAML/Markdown 能解析
permissions 能阻止危险操作
message compiler 能生成 messages
active tool pack 能生成
provider profile 能解析
没有真实 key
没有自举专用 runtime
没有按当前项目名分支的特殊逻辑
candidate eval 能运行
```

失败时：

```text
不更新 validated commit
不丢弃 working tree
写入 .feng/artifacts/check-report-*.md
.feng/state.yaml 标记 candidate_status: failed
下一轮 grow 读取 artifact refs 和 diff 修复 candidate
```

通过时：

```text
更新 validated_commit
创建 checkpoint commit
允许 hatch
```

## 5. 当前 MVP 文档能跑通的部分

```text
无预置项目 skill
通用 seed loop
初始四工具
provider-neutral LLM 层
message compiler 稳定顺序
artifact refs
Git candidate/validated/tag
check 失败不强制回滚
hatch --name feng --portable
```

## 6. 当前 MVP 文档还不稳的部分

1. LLM 错误恢复没有进入 grow loop：max_tokens、prompt_too_long、429/529、provider config 错误应该写入 state/events/artifacts，并决定 retry/blocked。
2. skill 两级加载没有模块化落地：MVP 说有 skill-ready context assembly，但没有定义 skill catalog、按需 load、预算和 cache 关系。
3. active tool pack 只写了规则，没有定义 tool registry、tool pack hash、tool growth 后的 cache 失效。
4. 模块详细设计文档缺失，实现时仍可能把 feng 自举逻辑写进 runtime。
5. run_command 长输出和慢命令的最小生命周期不够清楚。

## 本轮判断

MVP 主线正确，但还没有达到“把架构文档变成可实施方案”的粒度。需要补齐模块设计，并把 Claude Code 的成熟经验压缩成 feng 的少量 kernel contract。
