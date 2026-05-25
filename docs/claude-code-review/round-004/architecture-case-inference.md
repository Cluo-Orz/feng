# Claude Code 借鉴 Review 第 4 轮：架构 Case 收敛推演

本轮只复核主文档和模块文档，不把历史 round 中已修复的问题重新计入当前设计。

## 七个 case

| Case | 当前结论 |
| --- | --- |
| Coding Agent | 能从空 `skills/` 通过 seed loop 长出代码相关 skill/tool/eval；测试日志和 diff artifact 化；权限限制危险命令。 |
| API Testing Agent | API schema 进 world，token/base-url 进 config/args；HTTP tool 由 grow 生成；active tool pack 和 cache hash 可观测。 |
| News Summary Agent | 新闻正文/搜索结果 artifact 化；稳定摘要规则进入 skill/world index；动态文章列表在 suffix。 |
| Robot Car Agent | 传感器/控制说明进入 world；控制 tool 受 permission；实时数据走动态后缀或 artifact。 |
| Windows Desktop Assistant | 文件整理、dry-run、PowerShell 权限可由 grow 生成；使用者只运行命名命令。 |
| Claude Code Session Manager | 会话日志、diff、handoff artifact 化；默认只读 permission 可表达。 |
| Feng 自举 | 不需要特殊 runtime；通过同一 self repo、state、Git、LLM/tool/message/check/hatch 机制迭代自己。 |

## R01-R20 复核

```text
LLM 对接              已定义 provider-neutral 层。
Function Call         已定义 Tool/ToolCall/ToolResult。
自造工具              grow 修改 tools/，check 验证。
Token Efficiency      stable prefix、dynamic suffix、artifact refs、active tool pack。
协议兼容              OpenAI-compatible / Anthropic adapter。
Message 编排          provider tools -> system -> user manifest -> suffix -> latest event。
Prompt/Skill 模块化   skill 是成长单位，hook 是时机。
GUI/CLI               CLI 主路径，GUI 只读。
初始工具              read/write/list/run_command。
白板孵化              默认 skills/ 为空。
文件即自我            self repo 文件约定明确。
Git 成长              candidate/validated/tag。
Reload/Repair         失败 candidate 保留，从 validated self 修复。
World                 world 是说明书，artifact 是证据。
长任务                state/events/artifacts/recovery。
可观测性              status/watch/artifacts 和 state 快照。
打包传播              hatch 成命名命令。
配置权限              config/schema + permission boundary。
自举                  feng hatch --name feng --portable。
简单不过拟合          四对象：Kernel + Self Repo + .feng State + Git。
```

## 收敛判断

当前主设计能覆盖七个 case，没有发现需要继续修改主文档的结构性问题。
