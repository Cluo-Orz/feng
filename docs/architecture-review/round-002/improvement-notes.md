# 第 2 轮改进文档

## 1. 总体判断

第 1 轮补齐后，架构已经能较好支撑：

```text
领域工具成长
world 作为环境说明
eval 最小形态
tool call permission check
```

第 2 轮推演显示，新的结构性问题集中在 release 后的运行边界：

```text
creator workspace 和 user runtime 没有明确区分
world 和 config 的职责容易混淆
release manifest 对运行环境要求描述不足
```

这些问题影响六个 case，不是单点补丁。

## 2. 缺口一：creator workspace 与 user runtime

### 问题

feng 孵化时运行在创造者 workspace。

release 后，命令运行在使用者机器。

当前架构强调 workspace，但没有明确区分：

```text
创造者的 workspace state
release 包里的 frozen self
使用者机器上的 runtime state
```

### 影响

如果不区分，容易把创造者机器的信息打包给使用者：

```text
项目路径
API base URL
新闻订阅源
硬件设备地址
Windows 用户目录
会话记录目录
```

这些通常不应该固化进 self repo。

### 建议修改

增加一个 “Creator Workspace 与 User Runtime” 小节：

```text
creator workspace
  用来 teach、try、release。

release package
  frozen self + runner + manifest。

user runtime
  使用者机器上的 .feng-like 本地状态、配置和 artifacts。
```

核心原则：

```text
self 固化规则和能力。
config 保存使用者本地事实。
args 表示单次运行输入。
artifacts 保存运行证据。
```

## 3. 缺口二：world 与 config 的边界

### 问题

当前架构已经说明 world 是环境说明书，但没有明确：

```text
哪些环境事实可以进入 world
哪些应该留在 config
```

### 建议规则

```text
world
  稳定、可复用、可随 release 传播的环境模型。

config
  使用者机器上的本地事实、密钥、路径、设备地址、偏好。

args
  单次运行输入。
```

示例：

```text
API 响应 schema -> world
用户的 API token -> config
本次 --base-url -> args 或 config

小车传感器含义 -> world
小车设备地址和校准参数 -> config
本次 patrol --speed low -> args

Windows 文件分类规则 -> skill/world
用户 Downloads 路径 -> config 或 args
```

## 4. 缺口三：release manifest 不够明确

### 问题

当前架构说：

```text
release = validated self + runner + manifest + checksums
```

但 manifest 具体要承载什么不清楚。

### 建议补充

release manifest 至少表达：

```text
name
version/tag
self commit
runner version
target platform
required tools
required permissions
config schema
interface
checksums
```

这样 portable release 才能在另一台机器上判断：

```text
能不能运行
缺什么配置
需要什么权限
平台是否匹配
```

## 5. 不建议修改的方向

不要引入复杂环境管理系统。

不要把 user runtime 做成另一个 self repo。

不要为每个 agent 类型设计专用发布格式。

只需要把 release 边界说清楚：

```text
self 是产品内部结构
manifest 是运行说明
config 是使用者本地事实
args 是本次输入
```

## 6. 本轮应修改的架构内容

建议只做三个小改：

1. 增加 “Creator Workspace 与 User Runtime”。
2. 在 World 或权限配置章节补充 world/config/args 边界。
3. 在 Release Package 中补充 manifest 的最小内容和平台要求。

这些是跨 case 的结构性修改，符合“不新增复杂系统”的约束。

