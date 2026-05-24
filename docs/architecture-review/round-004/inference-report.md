# 第 4 轮稳定性推演报告

## 1. 目标

本轮检查压缩后的 `docs/architecture.md` 是否仍然覆盖六个目标 agent 的主要生命周期，并判断是否还需要修改架构文档。

## 2. 共同链路

压缩后的架构仍保留共同链路：

```text
feng new <name>
feng teach ...
feng try
feng release --name <command> --portable
<command>
```

仍保留关键内部结构：

```text
Runtime Kernel
Self Repo
.feng State
Git
```

仍保留关键机制：

```text
skill-first context assembly
tool growth
world/config/args 边界
workspace state 和可观测性
Git candidate / validated commit / tag
release manifest
permission check
```

## 3. 六个 case 覆盖情况

### Coding Agent

覆盖情况：

```text
代码项目 -> world
代码能力 -> skills
测试/构建命令 -> tools + permissions
示例项目 -> evals
目标项目路径 -> args/config
release -> coder
```

结论：主路径覆盖。

### API Testing Agent

覆盖情况：

```text
API schema -> world
HTTP 请求 -> tool growth
token/base URL -> config/args
mock 响应 -> evals
网络权限 -> permissions
release -> apitest
```

结论：主路径覆盖。

### 汇总新闻 Agent

覆盖情况：

```text
新闻源模型 -> world
抓取/RSS -> tool growth
订阅源和 API key -> config
长文章 -> artifacts + context summary
引用和时间过滤 -> skills/evals
release -> newsbrief
```

结论：主路径覆盖。

### 小车 Agent

覆盖情况：

```text
传感器含义和安全规则 -> world
传感器/电机接口 -> tool growth
设备地址和校准参数 -> config
安全速度 -> args/config
传感器模拟 -> evals
release -> carbrain
```

结论：主路径覆盖。实时控制细节属于具体 skill/tool 设计，不应进入顶层架构。

### Windows 桌面助手 Agent

覆盖情况：

```text
Windows 环境模型 -> world
PowerShell/桌面能力 -> bootstrap tool 或 tool growth
用户目录 -> config/args
目录权限 -> permissions
dry-run 计划 -> evals/artifacts
release -> deskhelper
```

结论：主路径覆盖。

### Claude Code 会话管理 Agent

覆盖情况：

```text
会话概念和 handoff -> world
摘要/handoff 能力 -> skills
项目和会话目录 -> config/args
长会话摘要 -> context budget + artifacts
默认不改代码 -> permissions
release -> ccmanage
```

结论：主路径覆盖。

## 4. 稳定性判断

当前架构文档覆盖六个 case 的共同生命周期，同时没有为单个 case 引入专用机制。

现有抽象能解释：

```text
代码项目
API 服务
新闻源
硬件小车
Windows 桌面
Claude Code 会话
```

说明当前架构具备跨领域泛化能力。

## 5. 结论

本轮未发现需要修改 `docs/architecture.md` 的结构性缺口。

继续迭代的重点应从架构概念转向后续实现规格，例如：

```text
tool spec
eval spec
release manifest spec
permission spec
```

这些不应继续塞进架构概念文档。

