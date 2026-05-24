# 第 2 轮推演报告

## 1. 输入文档

本轮依据第 1 轮修改后的文档：

```text
docs/core-requirements.md
docs/architecture.md
docs/agent-expectations/*.md
docs/architecture-review/round-001/*
```

第 1 轮已经补充：

```text
World
Tool Growth
eval 最小形态
tool call permission check
```

本轮继续客观推演六类 agent 的生命周期。

## 2. 共同生命周期

按当前架构，六类 agent 都可以走：

```text
feng new <name>
feng teach ...
feng try
feng release --name <command> --portable
<command>
```

当前架构明确支持：

```text
self repo 文件化
workspace state
Git candidate / validated commit / tag
skill-first context assembly
tool growth
permissions at tool call boundary
evals: example / fixture / mock / command
named portable release
```

## 3. Coding Agent

`coder` 的生命周期比第 1 轮更清晰。

```text
world/     项目结构、测试、构建脚本、Git 状态
skills/    代码阅读、测试执行、变更摘要、命令安全
tools/     bootstrap tools + 可选 Git/test helper
evals/     示例项目 fixture + command eval
permissions 读写项目、运行 test/build/lint
```

release 后，使用者在另一个项目中运行 `coder`。此时项目路径、测试命令、模型密钥属于使用者机器上的配置或参数。

当前架构能描述主要路径。

仍不够明确：

```text
world/ 里的项目结构是通用模型，还是 release 时固化的具体项目？
使用者运行 coder 时，目标项目路径如何和 release self 区分？
```

## 4. API Testing Agent

`apitest` 现在可以通过 tool growth 获得 HTTP 请求工具。

```text
world/      API 概念、OpenAPI、认证方式、响应 schema
tools/      fetch_http 或 api_request
evals/      OpenAPI fixture + mock response
permissions 允许访问指定 base URL
config      token、默认 base URL
interface   --spec、--base-url、smoke、case
```

当前架构能描述 API tool 的创建、验证、打包和权限检查。

仍不够明确：

```text
base URL 是 world、config 还是参数？
用户机器上的 token 和 endpoint 不应写进 release self。
release manifest 需要表达运行环境要求。
```

## 5. 汇总新闻 Agent

`newsbrief` 可以通过 tool growth 获得 RSS/HTTP 获取工具。

```text
world/      新闻源类型、主题、时间范围、引用规则
tools/      fetch_rss、fetch_page
evals/      article fixtures + mock source
permissions 允许访问声明过的新闻源
config      用户订阅源、默认主题
interface   daily、--topic、--limit、--format
```

当前架构能描述长文章进入 artifacts、摘要进入 context 的方式。

仍不够明确：

```text
用户订阅源是稳定 self 还是用户本地配置？
不同使用者的新闻源不应该被打包进同一个 release。
```

## 6. 小车 Agent

`carbrain` 可以通过 tool growth 获得传感器和控制工具。

```text
world/      传感器含义、控制规则、安全限制
tools/      read_sensor、set_motor、stop_motor
evals/      sensor mock + control decision example
permissions 读取传感器、写控制指令
config      设备地址、校准参数、安全速度
interface   patrol、stop、calibrate
```

当前架构能描述工具进入 self、mock eval、权限检查。

仍不够明确：

```text
硬件设备地址、校准参数、目标平台依赖不应写死在 self。
portable release 对硬件依赖的表达还不清楚。
实时控制循环和 feng 基础 loop 的关系需要边界说明。
```

## 7. Windows 桌面助手 Agent

`deskhelper` 可用 bootstrap tools 和可选 Windows 工具完成。

```text
world/      Windows 文件系统、桌面、PowerShell、用户目录概念
tools/      run_command、可选 desktop helper
evals/      文件 fixture + dry-run command eval
permissions 授权目录、受限 PowerShell
config      用户默认目录和偏好
interface   organize、find、cleanup、config
```

当前架构能描述权限检查和首次配置。

仍不够明确：

```text
用户本机路径属于 config，不应进入 release self。
release manifest 需要表达仅支持 Windows 或特定平台。
```

## 8. Claude Code 会话管理 Agent

`ccmanage` 主要使用文件和 Git 状态，当前架构覆盖较好。

```text
world/      coding 会话、handoff、任务计划、Git diff
skills/     会话摘要、diff 摘要、handoff 生成
tools/      read_file、write_file、run_command
evals/      示例项目状态 fixture
permissions 读项目、写 handoff、默认不改代码
config      会话记录目录、本地项目路径
```

仍不够明确：

```text
会话记录目录和目标项目路径属于使用者本地配置。
release self 只应包含会话管理规则，不应包含创造者本地路径。
```

## 9. 跨案例观察

第 1 轮新增的 Tool Growth 和 World 能覆盖大部分领域能力问题。

第 2 轮出现的新共性问题是：

```text
creator workspace 和 user runtime 没有被明确区分
world 和 config 的边界需要更清楚
release manifest 需要表达运行环境要求
```

这些不是单个 case 的问题。它们会影响：

```text
coder 的项目路径
apitest 的 base URL 和 token
newsbrief 的订阅源
carbrain 的设备地址和校准参数
deskhelper 的用户目录和平台
ccmanage 的会话目录
```

## 10. 本轮客观结论

当前架构已经能描述“agent 如何成长”和“领域工具如何进入 release”。

但 release 到另一台机器后，必须区分：

```text
self repo 中的稳定自我
使用者机器上的本地配置
单次运行参数
release manifest 中的平台和能力要求
```

如果不区分，world/、config.schema.yaml、interface.yaml、permissions.yaml 的职责会混淆，影响易用性和可传播性。

