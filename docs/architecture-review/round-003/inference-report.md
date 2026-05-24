# 第 3 轮推演报告

## 1. 输入文档

本轮依据：

```text
docs/core-requirements.md
docs/architecture.md
docs/agent-expectations/*.md
docs/architecture-review/round-001/*
docs/architecture-review/round-002/*
```

本轮重点不再寻找单个 agent 的能力缺口，而是检查当前架构文档是否仍然适合作为顶层概念文档。

## 2. 当前架构状态

经过前两轮，`docs/architecture.md` 已经覆盖：

```text
Runtime Kernel + Self Repo
Workspace State
可观测性
Loop 和上下文
Context Budget
Skill
Tool Growth
Teach / Try / Release
长任务保证
Git 成长版本
模板
权限和配置
LLM 和缓存
易用性约束
MVP
```

当前文档已经能解释六个 case 的主要生命周期，但文档长度超过 600 行，开始从“架构概念”变成“机制细节集合”。

## 3. 六个 case 的当前推演状态

### Coding Agent

可以推演：

```text
new coder
teach 代码阅读、测试执行、命令安全
try 示例项目 eval
release coder
用户在另一个项目运行 coder
```

当前架构已覆盖主要问题。剩余细节属于实现规格，例如 tool schema、eval fixture 格式。

### API Testing Agent

可以推演：

```text
teach API spec、HTTP 工具、mock eval
release apitest
用户用 config/args 指定 token、base URL、spec
```

当前架构已覆盖主要边界。剩余细节属于 HTTP tool 和 release manifest 格式。

### 汇总新闻 Agent

可以推演：

```text
teach 新闻源处理、去重、摘要
RSS/HTTP 工具进入 tools
长文章进入 artifacts，摘要进入 context
release newsbrief
```

当前架构已覆盖主要边界。剩余细节属于新闻抓取工具和引用格式。

### 小车 Agent

可以推演：

```text
teach 传感器、控制、安全停止
工具成长生成 sensor/control tools
mock eval 验证控制决策
release carbrain
用户本地 config 提供设备地址和校准参数
```

当前架构已覆盖主要边界。实时控制细节属于具体 agent 的 tool/skill 设计，不应进入顶层架构。

### Windows 桌面助手 Agent

可以推演：

```text
teach 文件整理、PowerShell 安全、dry-run
permissions 限制目录和命令
release deskhelper
用户本地 config 提供目录偏好
```

当前架构已覆盖主要边界。

### Claude Code 会话管理 Agent

可以推演：

```text
teach 会话摘要、handoff、diff 摘要
context budget 处理长会话
release ccmanage
用户本地 config 提供会话目录和项目路径
```

当前架构已覆盖主要边界。

## 4. 跨案例观察

从六个 case 看，当前架构缺的不是新机制，而是文档形态需要收敛。

当前文档有两个问题：

```text
概念文档承担了太多机制细节
同一原则在多个章节重复出现
```

例如：

```text
self/config/args/artifacts 边界
permissions 既在 release、权限章节、易用性章节出现
eval 既在 teach/try，也在 MVP 和易用性约束出现
```

这些内容本身是对的，但顶层架构文档不应继续膨胀。

## 5. 本轮客观结论

当前架构已经基本贴合核心诉求：

```text
逻辑自洽：基本满足
设计合理：基本满足
架构简单：核心模型简单，但文档表达开始变重
易用：产品链路清晰
传播潜力：release 成命名命令的方向清晰
```

本轮不应继续新增机制，而应压缩 `architecture.md`，让它重新成为顶层架构概念文档。

