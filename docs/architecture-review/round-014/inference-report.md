# 第 14 轮推演报告

## 1. 本轮目的

本轮不是检查 `new/init-self` 这两个词本身，而是检查三份主文档是否仍在用“工程动作”替代“产品语义”。

输入：

```text
docs/core-requirements.md
docs/architecture.md
docs/mvp-self-iteration-design.md
docs/agent-expectations/*
```

判断标准：

```text
创造者只需要理解 grow / check / hatch
第一次 grow 可以 bootstrap，但 bootstrap 不是产品命令
self repo、world、tool、message、Git、hatch 必须在所有 case 中同构
不能因为自举、已有目录或某个目标 agent 增加专用系统
```

## 2. Case：Coding Agent

### 生命周期推演

创造者在一个目录中执行 `feng grow "孵化本地代码助手"`。如果目录还不是 feng workspace，第一次 grow 创建最小 self 文件、`.feng/` 和 Git 成长语义；已有代码、测试、构建脚本先作为 world 和可感知目标，不应被覆盖。

成长期间，bootstrap tools 足够读文件、写文件、列目录、运行受限测试命令。后续可 grow 出更具体的代码工具，但每轮只暴露当前 skill 需要的 active tool pack。

message list 中，kernel contract、self contract、active tool schema 是稳定前缀；最近失败测试、diff、用户目标、tool response 是动态后缀；长日志、长 diff 进入 artifact refs。

check 验证 self 能加载、permissions 能限制命令、示例项目 eval 能通过。失败时保留 candidate working tree 和 test-log artifact；agent 从 validated self 启动，继续修复 candidate。hatch 后使用者只运行 `coder ...`。

### 覆盖状态

```text
R01-R09  满足。LLM、ToolCall、初始工具、message/cache、skill-first 都能覆盖。
R10-R14  部分满足后已修正。需要明确第一次 grow 不覆盖已有代码，而是补齐 self 并感知 world。
R15-R18  满足。长任务、可观测性、hatch、config/permissions 都有对应机制。
R19      实现期细节。coding agent 不直接验证 self-hatching。
R20      满足。无需新增 code-agent 专用系统。
```

## 3. Case：API Testing Agent

### 生命周期推演

第一次 grow 建立 self skeleton，world 记录 OpenAPI、base URL 语义、认证方式和响应 schema。API token 进入 config，不进入 self repo。HTTP 请求工具可以由 grow 新增到 tools/，并由 permissions 限制域名。

message list 不应把完整 OpenAPI 和响应全集塞进 prompt。spec、response、schema mismatch report 进入 artifact refs，latest event 只带当前失败原因和必要片段。

check 通过 mock 或受限 endpoint eval 验证 tool、schema、权限和报告格式。hatch 后使用者运行 `apitest smoke --spec ... --base-url ...`。

### 覆盖状态

```text
R01-R06  满足。
R07      满足。API 测试能力应是 skill，不是散乱 prompt。
R08-R09  满足。
R10      满足。默认模板只提供 self 形状，API 能力由 grow 长出。
R11-R14  满足。
R15-R18  满足。
R19      实现期细节。
R20      满足。无需 API 专用 runtime。
```

## 4. Case：汇总新闻 Agent

### 生命周期推演

创造者用 grow 给出新闻来源、主题、引用规则和新旧判断标准。world 描述新闻源、时间语义、去重规则和引用格式；用户本地订阅、token 和偏好进入 config。

新闻正文、搜索结果、网页正文和去重报告默认文件化。message 只保留来源、hash、摘要、为什么相关和必要片段，避免长任务上下文膨胀。

check 用 fixture 文章验证去重、时间过滤、引用和摘要格式。hatch 后 `newsbrief daily` 对使用者呈现为普通命令。

### 覆盖状态

```text
R01-R09  满足。
R10-R12  满足。
R13      满足。失败摘要作为 candidate 继续修复，不自动丢弃。
R14      满足。world 是新闻世界说明书，不是抓取日志。
R15-R18  满足。
R19      实现期细节。
R20      满足。无需新闻专用系统。
```

## 5. Case：小车 Agent

### 生命周期推演

第一次 grow 建立 self，world 描述传感器、控制接口、安全停止和低风险运行环境。设备地址、校准值和密钥进入 config；单次速度、模式进入 args。

传感器读取和电机控制是领域工具，必须由 grow 写入 tools/ 并经 check 验证。高风险动作由 permissions 限制。camera frame、sensor log、control report 进入 artifacts，message 只放最小摘要。

check 优先用模拟器或 fixture 验证停止、转向、权限和异常处理。hatch 后使用者只运行 `carbrain patrol --speed low`，不理解 feng。

### 覆盖状态

```text
R01-R08  满足。
R09      满足。初始四工具足够生成和验证领域工具，不直接控制小车。
R10-R12  满足。
R13      满足但必须表达清楚：修复 candidate，不是运行时强制 reset。
R14-R18  满足。
R19      实现期细节。
R20      满足。安全边界靠 permissions/tool/eval，不新增机器人专用内核。
```

## 6. Case：Windows 桌面助手 Agent

### 生命周期推演

grow 根据用户规则生成文件整理 skill、dry-run eval、PowerShell 权限和 interface。桌面路径、下载目录和偏好是 config；目录语义和操作规则是 world。

大文件 list、dry-run report 和 PowerShell 输出进入 artifacts。message 只保留摘要、路径、hash、why_relevant，避免每轮重复塞完整目录树。

check 验证 dry-run 不修改文件、危险命令被拒绝、未授权目录不能访问。hatch 后使用者运行 `deskhelper cleanup --dry-run`。

### 覆盖状态

```text
R01-R12  满足。
R13      满足。失败操作计划保留为 artifact，agent 修复规则。
R14-R18  满足。
R19      实现期细节。
R20      满足。权限不是单独复杂系统，而是 self + manifest + runner guard。
```

## 7. Case：Claude Code 会话管理 Agent

### 生命周期推演

grow 生成读取会话记录、Git diff、handoff 输出和默认只读边界的 skills/evals。world 描述项目结构、会话记录、handoff 格式和 Git 语义。

长会话日志、diff、命令输出进入 artifacts。message 使用 stable prefix + latest event，避免把所有历史会话塞进 context。

check 验证能从 fixture 生成准确 handoff，默认不修改业务代码。hatch 后使用者运行 `ccmanage handoff`。

### 覆盖状态

```text
R01-R18  满足。
R19      实现期细节。
R20      满足。它是普通目标 agent，不需要特殊会话系统。
```

## 8. Case：Feng 自举

### 生命周期推演

当前 feng 仓库中执行 `feng grow "让 feng 更好地校准自己的架构、代码和验证方式"`。如果缺失 self 文件，第一次 grow 只补齐 self 层和 `.feng/`，不覆盖 docs、review 轮次、源码和 Git 历史。

feng 自举读取核心诉求、架构文档、MVP 文档、目标 agent 文档和 Git 状态。它通过相同的 tool call 修改 docs/specs/skills/evals 或代码；长 diff、review report、check report 进入 artifacts。

check 禁止特殊 runtime、`fengsmith`、真实 API key、默认 push/reset/delete。失败时保留 candidate，agent 读取 diff 和失败报告继续修复。通过后 validated commit 可被 `feng hatch --name feng --portable` 打包成下一版 feng。

### 覆盖状态

```text
R01-R18  满足。
R19      部分满足后已修正。主路径不能出现 init-self 或另造 fengsmith；第一次 grow bootstrap 才是通用起点。
R20      满足。自举仍然回到 Runtime Kernel + Self Repo + .feng State + Git。
```

## 9. 结构性发现

本轮发现三个全局问题：

```text
1. 主文档仍有历史术语残留，会让产品语义变脏。
2. 第一次 grow 的 bootstrap 没有说明“不覆盖已有目录”，会影响自举和已有项目。
3. Git 感知方式不够明确，容易被误读为隐藏自动回滚。
```

这些不是单个 case 的 workaround。它们影响所有 case 的起点、修复方式和用户理解成本，因此需要修改三份主文档。
