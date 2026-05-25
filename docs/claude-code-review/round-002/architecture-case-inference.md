# Claude Code 借鉴 Review 第 2 轮：架构 Case 推演

本轮重新阅读核心诉求、架构、MVP、LLM 和 MVP 模块文档后推演。重点检查第一轮改动是否真正通用于七个目标 agent，而不是只服务 feng 自举。

## 1. Coding Agent

生命周期：

```text
grow -> seed loop 感知源码/测试/Git -> 生成 coding skill/world/eval/interface
check -> 运行 baseline eval 和项目测试 fixture
hatch -> coder 命名命令
execute -> 使用 frozen self + 本机 config + args
```

细节检查：

```text
LLM/function call     满足：provider-neutral LLM + ToolCall/ToolResult。
自造工具             满足：可 grow 出 test/lint/git-helper，但必须 check。
token efficiency      满足：源码/日志/diff artifact 化，skill index 稳定。
OpenAI/Anthropic      满足：LLM doc 定义 adapter 映射。
初始工具             满足：只有 read/write/list/run_command。
长任务               基本满足：有 recovery、events、artifacts。
风险                 state 主文档没有记录 active_tool_pack_hash/recovery 状态字段，status 可观测性不够细。
```

## 2. API Testing Agent

生命周期：

```text
grow -> 读取 OpenAPI 示例和用户目标 -> 生成 HTTP tool、API world、mock eval
check -> 验证 schema、权限、secret、mock endpoint
hatch -> apitest
execute -> apitest smoke/regression/case
```

细节检查：

```text
world/config/args     满足：schema 进 world，token/base-url 进 config/args。
permissions           满足：访问指定 base URL，不默认访问其他域名。
tool growth/cache     满足方向：active_tool_pack_hash 已写入 LLM/MVP，但 state 快照缺字段。
artifact              满足：请求/响应长内容写 artifact。
风险                 provider/profile 错误会进入 missing_config，但 MVP state mode 列表未包含 missing_config。
```

## 3. News Summary Agent

生命周期：

```text
grow -> 生成 source world、fetch/read tool、dedupe skill、citation eval
check -> 示例文章去重、时间过滤、引用保留
hatch -> newsbrief
execute -> newsbrief daily/topic/source
```

细节检查：

```text
token efficiency      满足：正文和搜索结果 artifact 化。
cache prefix          满足：摘要规则和引用格式稳定。
dynamic suffix        满足：当天文章列表和去重结果动态。
风险                 context pressure 后的 state 可观测字段不足，用户只能看到 blocked，难以知道是 prompt_too_long 还是 provider retry 失败。
```

## 4. Robot Car Agent

生命周期：

```text
grow -> 读取传感器/控制接口说明 -> 生成 car world、control tool、安全 eval
check -> 模拟传感器输入验证停止/转向
hatch -> carbrain
execute -> patrol/stop/calibrate
```

细节检查：

```text
world                 满足：稳定硬件说明进入 world。
permissions           满足：高风险控制动作受 tool boundary。
long task             基本满足：events/artifacts 可记录控制决策。
风险                 控制类 agent 更需要 status 展示最近 recovery/control event；state schema 应明确 last_error/recovery_count，不要只靠日志全文。
```

## 5. Windows Desktop Assistant

生命周期：

```text
grow -> 读取目录样本和用户规则 -> 生成 file skill、PowerShell permissions、dry-run eval
check -> dry-run 不改文件，权限越界失败
hatch -> deskhelper
execute -> organize/find/config
```

细节检查：

```text
初始工具             满足。
permissions           满足：删除、敏感目录、关闭应用默认禁止。
artifact              满足：dry-run plan 和操作报告可 artifact 化。
风险                 run_command 慢命令/大输出的 state 字段未明确；可以先不做完整后台系统，但必须能观测 provider/tool recovery。
```

## 6. Claude Code Session Manager

生命周期：

```text
grow -> 生成 session world、handoff skill、Git diff skill、只读 permissions
check -> fixture 会话生成 handoff
hatch -> ccmanage
execute -> summarize/handoff/status
```

细节检查：

```text
artifact              满足：长会话和 diff artifact 化。
skill loading         满足：handoff skill body 按需加载。
memory/world/artifact 满足方向：world 是说明书，artifact 是证据。
风险                 模块文档说明了 state/events，但主 MVP state 还没同步 token/cache/recovery 可观测字段。
```

## 7. Feng 自举

生命周期：

```text
grow -> seed loop 读取 docs、agent-expectations、review artifacts、Git
candidate -> 修改架构/MVP/LLM/module docs 或源码
check -> schema、message compiler、permissions、provider profile、no secret、no special runtime
repair -> 失败不回滚，读取 diff/check report 修复 working tree
hatch -> feng portable
```

细节检查：

```text
无预置 skill          满足。
通用逻辑             满足：seed loop 对所有 workspace 相同。
Claude Code native化 满足：skill 两级加载、context recovery、active tool pack/cache 已入主文档。
模块设计             满足：新增 mvp-modules。
风险                 主 MVP state 与 module state 不一致：missing_config、active_tool_pack_hash、recovery 字段未同步。
```

## 本轮结论

架构方向继续成立。第二轮发现的问题不是方向性错误，而是跨文档 schema 不一致：

```text
MVP 主文档 state.yaml 过窄。
模块文档已有 missing_config/recovery/cache 语义，但主 MVP state 没同步。
status/watch/artifacts 可观测性会因此不足。
```

需要修主 MVP 文档和 state module，让长任务恢复与 token/cache 指标可观察。
