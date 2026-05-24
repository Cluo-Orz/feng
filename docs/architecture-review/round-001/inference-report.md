# 第 1 轮推演报告

## 1. 输入文档

本轮只依据当前可见文档进行推演：

```text
docs/core-requirements.md
docs/architecture.md
docs/agent-expectations/*.md
```

推演目标不是提出新设计，而是客观描述：按当前架构文档，六类目标 agent 从 feng 创建到 release 后被使用，生命周期应该是什么样。

## 2. 共同生命周期

六类 agent 都共享同一条产品链路：

```text
feng new <name>
  -> 创建 self repo
feng teach ...
  -> 修改 skills / hooks.yaml / evals / interface / permissions
feng try
  -> load / schema / eval
feng release --name <command> --portable
  -> validated self + runner + manifest + checksums
<command>
  -> 使用者直接运行命名命令
```

共享的运行模型：

```text
workspace = self repo + .feng runtime state + Git history
```

共享的状态和可观测性：

```text
.feng/state.yaml
.feng/lock
.feng/events.jsonl
.feng/artifacts/
```

共享的上下文模型：

```text
hook   = 什么时候介入
skill  = 用什么能力介入
tool   = 对外部世界做什么动作
message = 本轮临时组装出的 LLM 输入
```

共享的版本模型：

```text
validated commit
working tree candidate
tag
release
```

## 3. Coding Agent 推演

目标命令：`coder`

### 生命周期

1. 创造者执行 `feng new coder`，生成基础 self repo。
2. 创造者执行 `feng teach "修复测试、审查代码、解释代码"`。
3. teach 过程应沉淀代码相关 skills，例如代码阅读、测试执行、命令安全、变更摘要。
4. self repo 中的 `world/` 描述软件项目 workspace、源代码、测试、构建脚本、Git 状态。
5. `permissions.yaml` 声明读取项目文件、写入项目文件、运行 test/build/lint、读取 Git 状态。
6. `evals/` 包含示例项目、失败测试和期望修复结果。
7. `feng try` 验证 self 能加载、schema 能解析、示例 eval 能通过。
8. `feng release --name coder --portable` 输出 `coder` 命令。
9. 使用者运行 `coder "修复这个测试失败"`。

### 当前架构支持情况

明确支持：

```text
文件型 self repo
skill-first context assembly
read_file / write_file / list_files / run_command
Git candidate 和 release
permissions manifest
evals
```

不够明确：

```text
如何把测试项目 fixture 放入 evals
如何约束 run_command 只运行 test/build/lint
如何将代码变更报告作为 artifact 固化
```

## 4. API Testing Agent 推演

目标命令：`apitest`

### 生命周期

1. 创造者执行 `feng new apitest`。
2. 创造者 teach OpenAPI、base URL、smoke/regression 测试目标。
3. skills 应包括 API spec 阅读、请求生成、响应检查、报告生成。
4. `world/` 描述 API 服务、OpenAPI、认证方式、响应 schema。
5. `interface.yaml` 暴露 `--spec`、`--base-url`、`smoke`、`case`、`report`。
6. `permissions.yaml` 声明读取 spec、访问指定 base URL、读取 token、写报告。
7. `evals/` 使用示例 API spec 和模拟响应验证能力。
8. release 后使用者运行 `apitest smoke --spec openapi.yaml --base-url ...`。

### 当前架构支持情况

明确支持：

```text
interface.yaml
permissions.yaml
config.schema.yaml
evals
release manifest
```

不够明确：

```text
HTTP 请求能力来自哪里
网络访问是工具、runner 能力，还是 run_command 间接实现
如何在 release 中声明和限制可访问域名
如何执行 mock API eval
```

## 5. 汇总新闻 Agent 推演

目标命令：`newsbrief`

### 生命周期

1. 创造者执行 `feng new newsbrief`。
2. 创造者 teach 新闻源、主题过滤、去重和摘要规则。
3. skills 应包括新闻源读取、网页/RSS 解析、去重、聚类、摘要、引用保留。
4. `world/` 描述 RSS、网页文章、时间范围、来源链接。
5. `permissions.yaml` 声明访问指定新闻源、读取订阅配置、写摘要文件。
6. `evals/` 用一组示例文章验证去重、时间过滤和引用保留。
7. release 后使用者运行 `newsbrief daily` 或 `newsbrief --topic AI`。

### 当前架构支持情况

明确支持：

```text
skills
world
permissions
config.schema
context budget
release 成命名命令
```

不够明确：

```text
网页/RSS 获取能力来自哪里
如何处理必须联网但不能访问任意网站的权限
如何避免新闻内容和长文章撑爆 context
如何把来源引用作为 artifact 和 summary 区分管理
```

## 6. 小车 Agent 推演

目标命令：`carbrain`

### 生命周期

1. 创造者执行 `feng new carbrain`。
2. 创造者 teach 传感器、控制接口、安全停止条件和低速巡航目标。
3. skills 应包括传感器解释、障碍判断、低风险控制、安全停止。
4. `world/` 描述距离传感器、摄像头帧、电机控制、速度限制、安全停止。
5. `tools/` 需要表示读取传感器和写入控制指令的能力。
6. `permissions.yaml` 声明允许读取传感器、写控制指令、写运行日志。
7. `evals/` 应使用模拟传感器输入验证停止/转向/异常处理。
8. release 后使用者运行 `carbrain patrol --speed low`。

### 当前架构支持情况

明确支持：

```text
world 作为环境说明
permissions
evals
长任务状态和 artifacts
release 成命名命令
```

不够明确：

```text
传感器和电机控制工具如何进入 self repo
agent 如何自己造或接入硬件工具
硬件工具如何被 validate 和 release
实时/持续控制如何受单 loop 模型约束
高风险动作如何在工具调用边界强制限制
```

## 7. Windows 桌面助手 Agent 推演

目标命令：`deskhelper`

### 生命周期

1. 创造者执行 `feng new deskhelper`。
2. 创造者 teach 桌面整理、查找文件、dry-run 和确认规则。
3. skills 应包括文件分类、PowerShell 命令安全、操作计划、结果报告。
4. `world/` 描述 Windows 桌面、下载目录、文档目录、本地应用和 PowerShell。
5. `interface.yaml` 暴露 organize、find、cleanup、config。
6. `permissions.yaml` 限定授权目录和受限 PowerShell 命令。
7. `evals/` 使用示例目录验证 dry-run 和整理计划。
8. release 后使用者运行 `deskhelper organize --input ~/Downloads --dry-run`。

### 当前架构支持情况

明确支持：

```text
read/write/list/run_command
permissions manifest
config.schema
dry-run 可作为 skill/interface/eval 约定
release 成 xiaogui 类命令
```

不够明确：

```text
Windows 特定 runner 和 PowerShell 权限如何表达
窗口/进程/应用控制是否属于工具扩展
dry-run 是否是统一 runner 机制还是各 agent 自己实现
```

## 8. Claude Code 会话管理 Agent 推演

目标命令：`ccmanage`

### 生命周期

1. 创造者执行 `feng new ccmanage`。
2. 创造者 teach 会话摘要、handoff、Git diff 和待办整理规则。
3. skills 应包括会话整理、diff 摘要、handoff 生成、风险提取。
4. `world/` 描述项目目录、任务计划、Git diff、命令输出、handoff 文档。
5. `permissions.yaml` 声明读取项目/Git 状态、写 handoff、不默认改代码。
6. `evals/` 使用示例项目状态验证摘要准确性。
7. release 后使用者运行 `ccmanage handoff`。

### 当前架构支持情况

明确支持：

```text
文件读取和写入
Git 状态通过 run_command
artifacts 保存 handoff、diff、报告
permissions 限制默认不修改代码
context budget 处理长会话
```

不够明确：

```text
Claude Code 会话记录来源如何发现
长会话摘要如何从 artifacts 晋升为稳定经验
不同项目的本地配置如何隔离
```

## 9. 跨案例观察

当前架构对以下方向支持较清晰：

```text
把 agent release 成命名命令
self repo 文件化
skill-first context assembly
workspace state 和可观测性
Git candidate / validated commit / tag
权限、配置、接口进入 release manifest
```

当前架构在以下方向不够清晰：

```text
工具成长：初始四个工具之外，领域工具如何创建、验证、打包、授权
联网能力：API/news 场景需要 HTTP/RSS/search 能力，但架构没有说明能力来源
硬件能力：小车场景需要传感器和控制工具，但架构没有说明接入边界
权限执行：permissions.yaml 如何在 tool call 边界被强制执行
eval 形态：文件示例、mock 服务、硬件模拟、命令 fixture 的统一最小表达
world 形态：world/ 被列出，但架构文档没有单独说明它如何服务 context selection
```

## 10. 本轮客观结论

按当前文档，feng 的产品链路和核心理念可以覆盖六类 agent 的外形：创造者教出 self，try 验证，release 成命名命令。

但六类 agent 中 API、新闻、小车、Windows 桌面都需要超出初始四工具的领域能力。当前架构只列出 `tools/` 和四个初始工具，没有明确“工具如何成长”的最小机制。因此，架构对“文件即自我”和“可以自己造工具”的核心诉求还不完整。

此外，当前架构把 `world/` 放进 self repo，但没有解释 world 如何被组织、选择、进入 context。对小车、新闻、API 这类强环境 agent 来说，world 的定位需要更明确。

