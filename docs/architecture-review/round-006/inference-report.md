# 第 6 轮推演报告

## 1. 输入

本轮按最新三类文档推演：

```text
docs/core-requirements.md
docs/architecture.md
docs/agent-expectations/*
```

目标是检查第 5 轮后的架构是否能同时解释七个目标 agent，而不是继续为单个 case 打补丁。

## 2. 通用生命周期

按当前架构，任意目标 agent 的生命周期是：

```text
feng new <name>
  创建起始 self repo。

feng grow "目标、规则、示例、反馈"
  长任务开始，kernel 读取 self repo、Git、.feng state，循环执行 read files -> assemble context -> llm -> hook -> tool -> hook -> read files。

候选 self 变化
  grow 可以修改 skills、hooks、tools、world、evals、interface、permissions。

feng check
  验证 self 能加载、schema 能解析、tool 受权限约束、核心 eval 通过。

feng hatch --name <name> --portable
  将 validated self 冻结成命名命令。

<name>
  使用者运行命名命令，不需要理解 feng、self repo、Git、candidate。
```

每轮 LLM 输入由 kernel 组装 message list：

```text
kernel -> self -> event -> selected context -> working state -> history summary -> output contract
```

这解释了 context 从哪里来、如何压缩、如何缓存、如何映射 OpenAI / Anthropic adapter。

## 3. 七个 case 推演

### Coding Agent

`coder` 的 world 是项目结构、测试、构建和 Git 状态。grow 沉淀代码修改 skill、测试 skill、review skill。check 用 fixture 项目和受限 test/build 命令验证。hatch 后使用者只运行 `coder`。

当前架构能解释。

### API Testing Agent

`apitest` 的 world 是 API schema、endpoint 结构和测试规则。config 保存 token 和 base URL。tool 可以从 bootstrap 逐步成长出 HTTP 请求工具。check 用 mock API 或 fixture spec 验证。

当前架构能解释。

### 新闻汇总 Agent

`newsbrief` 的 world 是新闻源、主题结构、时间和引用规则。长日志与原文进入 artifacts，context 只保留摘要和必要引用。check 用示例文章验证去重、时间过滤和引用保留。

当前架构能解释。

### 小车 Agent

`carbrain` 的 world 是传感器含义、控制接口、安全停止条件。config 保存设备地址和校准参数。permissions 限制高速、持续运动和危险动作。check 先用模拟传感器和受限控制命令验证。

当前架构能解释。

### Windows 桌面助手 Agent

`deskhelper` 的 world 是授权目录、文件类型、PowerShell 操作边界。config 保存本机路径偏好。interface 暴露 dry-run 和确认参数。permissions 控制读写目录和命令范围。

当前架构能解释。

### Claude Code 会话管理 Agent

`ccmanage` 的 world 是项目、会话摘要、diff、handoff 结构。默认权限只读代码并写 handoff。message list 可以稳定加入当前 Git diff、任务状态和历史 summary。

当前架构能解释。

### Feng 自举

自举不是新 agent，而是当前 feng workspace 用同一套机制孵化下一版 `feng`：

```text
feng grow "让 feng 更好地校准自己的架构、代码和验证方式"
feng check
feng hatch --name feng --portable
```

它的 world 是 feng 仓库、核心诉求、架构文档、评审轮次、源码、测试和 Git 历史。check 必须验证文档一致性、基础 CLI、self 加载和 hatch 产物。hatch 后的命令仍然叫 `feng`。

当前架构能解释，且没有要求特殊 runtime。

## 4. 客观结论

第 5 轮之后，当前架构已经能用同一条主线解释七个 case：

```text
白板 self -> grow 长任务 -> check 验证 -> hatch 命名命令 -> 使用者只运行命令
```

本轮没有发现需要新增模块的结构性缺口。
