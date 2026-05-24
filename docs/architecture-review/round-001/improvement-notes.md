# 第 1 轮改进文档

## 1. 评审依据

本轮对照两份主文档：

```text
docs/core-requirements.md
docs/architecture.md
```

评审标准：

```text
是否满足原始核心诉求
是否逻辑自洽
是否设计合理
是否架构简单
是否易用
是否有传播潜力
是否避免过拟合单个 case
```

## 2. 总体判断

当前架构主线是成立的：

```text
Runtime Kernel + Self Repo + .feng State + Git
```

产品链路也成立：

```text
new -> teach -> try -> release -> named command
```

六个 case 的推演说明，架构能描述“最终变成一个命令”的产品形态，也能描述 workspace 持续孵化、可观测性和 release。

但还存在两个结构性缺口：

```text
工具成长不完整
world 定位不完整
```

这两个问题不是某一个 case 的特殊问题，而是会影响 API、新闻、小车、Windows 桌面、coding 等多个方向。

## 3. 缺口一：工具成长不完整

### 不一致点

核心诉求里明确包含：

```text
初始工具只有读文件、写文件、查文件 list、运行命令
可以自己造工具
用户可以给 agent 感知世界的工具和目标
```

当前架构文档只写了：

```text
tools/              工具声明和实现
四个初始工具：read_file、write_file、list_files、run_command
```

但没有说明：

```text
领域工具如何从 teach 中长出来
工具声明和实现如何被 validate
工具如何进入 release 包
permissions 如何约束工具调用
硬件、网络、桌面能力如何接入
```

### 影响

六个 case 中：

```text
API Testing 需要 HTTP 请求工具
News Summary 需要 RSS/网页获取工具
Robot Car 需要 sensor/control 工具
Windows Desktop 可能需要 PowerShell/窗口/进程工具
Coding 需要测试命令和 Git 访问边界
Claude Code 管理需要会话记录发现能力
```

如果工具成长不明确，feng 只能孵化 prompt/skill，不能真正孵化“能感知和影响世界的命令”。

### 建议修改

在架构文档中新增或补充“Tool Growth”：

```text
初始四工具是 bootstrap tools
领域工具属于 self repo
teach 可以新增/修改 tool 声明和实现
try 必须 validate tool schema、权限声明、加载方式、最小 eval
release 打包 validated tools
runner 在 tool call 边界执行 permissions
```

保持简单，不引入插件系统。

## 4. 缺口二：world 定位不完整

### 不一致点

核心诉求里已经定义：

```text
world/ 是 agent 对外部环境的可读说明书
```

当前架构文档只在 self repo 列表中写：

```text
world/ 对外部世界的描述
```

但没有说明：

```text
world 和 tool 的区别
world 和 permission 的区别
world 如何进入 context
world 如何成长
什么内容不应该进入 world
```

### 影响

对以下 case 影响明显：

```text
Robot Car：传感器含义、控制接口、安全停止条件属于 world
News Summary：新闻源、时间范围、引用规则属于 world
API Testing：OpenAPI、base URL、认证方式属于 world
Windows Desktop：桌面/下载目录/PowerShell 环境属于 world
```

如果 world 没有明确定位，运行日志、配置、工具说明、长期经验容易混在一起，最终破坏 context 控制和 self repo 清晰度。

### 建议修改

在架构文档中新增“World”小节：

```text
world = 环境说明书
tools = 改变或读取世界的接口
permissions = 允许接触世界的边界
artifacts = 运行证据
skills = 处理世界的能力
```

并补充：

```text
稳定环境事实进入 world
运行过程进入 .feng/artifacts
稳定经验被明确沉淀后才进入 self repo
context assembly 按当前事件选择相关 world 片段
```

## 5. 缺口三：eval 形态需要最小统一

### 不一致点

当前架构说 `evals/` 是成长标准，但没有说明 eval 可以如何表达。

六个 case 的 eval 形态不同：

```text
文件 fixture
命令输出
HTTP mock
传感器模拟
dry-run 计划
handoff 文档
```

### 建议修改

不需要复杂测试框架，只需要在架构文档里明确：

```text
evals/ 可以包含 example、fixture、mock、command 四类最小形式
try 只需要能运行少量核心 eval
eval 产物进入 .feng/artifacts
```

这能避免未来实现时把 eval 做成庞大系统。

## 6. 缺口四：权限需要落到 tool call 边界

### 不一致点

当前架构说 `permissions.yaml` 进入 release manifest，第一次运行展示摘要。

但对高风险 agent 来说，仅展示不够。权限必须在实际 tool call 时被 runner 检查。

### 建议修改

补充：

```text
permissions 是 manifest，也是 runner 的执行边界
每次 tool call 都要过 permission check
不满足权限时进入 waiting，要求用户确认或修改配置
```

这不是复杂权限系统，而是 tool executor 的最小 guard。

## 7. 不建议修改的方向

以下方向不应该加入本轮架构：

```text
不要引入插件市场
不要引入多 agent
不要引入复杂工作流引擎
不要把 world 做成长期记忆数据库
不要把 eval 做成完整测试平台
不要为每个目标 agent 单独设计专用架构
```

这些会违背“架构简单”和“禁止过拟合”。

## 8. 本轮应修改的架构内容

建议只做四个小而结构性的修改：

1. 增加 “World” 小节，明确 world 的定位和边界。
2. 增加 “Tool Growth” 小节，明确初始工具、领域工具、validate、release、permission guard。
3. 在 `try` 或 validate 中补充 eval 的最小形态：example、fixture、mock、command。
4. 在权限章节补充 permissions 在 tool call 边界强制执行。

这四点是跨 case 的系统性修正，不是针对某一个 case 的补丁。

