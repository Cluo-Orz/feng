# 第 8 轮推演报告

## 1. 输入

本轮按第 7 轮后的最新架构推演：

```text
token efficiency first
stable prefix + dynamic suffix
large content by reference
active tool pack
assistant / tool response 边界
```

目标是验证这些规则是否会破坏七个目标 agent 的生命周期。

## 2. 通用推演

每个 agent 的运行都可以拆成：

```text
稳定前缀
  kernel contract、self contract、active tool pack、稳定 skill/world index。

动态后缀
  最新任务、最近工具结果、当前失败原因、短状态摘要。

文件引用
  大文件、长日志、长 diff、网页正文、历史轮次报告。
```

这种结构不会改变 feng 的主路径：

```text
new -> grow -> check -> hatch
```

只改变每轮 LLM 输入如何省 token。

## 3. 七个 case 推演

### Coding Agent

代码库、测试输出、diff 都可能很长。

token-efficient 设计下：

```text
项目规则和当前 skill index 进入稳定前缀。
Git diff、测试日志、大文件只作为 artifact ref 进入 prompt。
需要修改具体文件时再 read_file。
active tool pack 保持 read/write/list/run_command 和少量代码工具。
```

这不会降低能力，反而避免测试日志挤掉关键指令。

### API Testing Agent

OpenAPI 文件可能很长。

token-efficient 设计下：

```text
API 概览和 endpoint index 进入 world/index。
完整 spec 作为文件引用。
本轮测试只注入相关 endpoint 片段。
HTTP 工具进入 active tool pack。
```

这要求 endpoint selection 做得稳定，但不需要新增复杂系统。

### 新闻汇总 Agent

文章正文和网页抓取结果很长。

token-efficient 设计下：

```text
source list 和主题规则进入稳定前缀。
文章正文进入 artifacts。
prompt 只保留标题、时间、来源、摘要、引用路径。
需要核对事实时再读取对应正文。
```

这符合新闻场景，且能降低旧新闻和重复文章占用 context 的风险。

### 小车 Agent

小车场景的动态数据很多，但每轮决策只需要最近状态。

token-efficient 设计下：

```text
安全规则、控制接口、传感器含义进入稳定前缀。
最新传感器状态进入 dynamic suffix。
原始传感器流进入 artifacts。
高风险控制工具受 permissions 限制。
```

这不会影响安全，反而让安全规则更稳定地留在前缀。

### Windows 桌面助手 Agent

文件列表可能很长，PowerShell 输出也可能很长。

token-efficient 设计下：

```text
用户授权目录和整理规则进入稳定前缀。
完整文件列表进入 artifact。
prompt 只放候选文件摘要和操作计划。
run_command 输出长时文件化。
```

这保持了 dry-run 和确认流程，也避免 prompt 被目录列表撑爆。

### Claude Code 会话管理 Agent

会话记录、diff、命令输出都可能很长。

token-efficient 设计下：

```text
handoff 格式和会话规则进入稳定前缀。
长会话和命令输出进入 artifacts。
prompt 只放当前 summary、风险、待办和文件引用。
```

这与它的目标一致，因为该 agent 本来就是做上下文压缩和交接。

### Feng 自举

feng 自己的架构评审轮次会越来越长。

token-efficient 设计下：

```text
核心诉求和当前架构摘要进入稳定前缀。
历史轮次报告作为 artifact refs。
本轮只读取相关轮次和 diff。
自举 hatch 仍使用同一套 message 编排。
```

这能避免 feng 在迭代自己时被历史文档淹没。

## 4. 风险评估

### 风险一：文件引用导致频繁 read_file

这是可接受风险。

原因是 read_file 是便宜、可追踪、可缓存的工具行为。相比每轮把全文塞进 prompt，按需读取更符合 token efficiency。

### 风险二：active tool pack 导致工具不可见

需要用简单规则约束：

```text
bootstrap tools 常驻。
当前 skill 需要的工具进入 active tool pack。
tool pack 在任务阶段内尽量稳定。
```

这不需要复杂 router。

### 风险三：摘要丢失细节

通过 artifact refs 缓解。

摘要只负责告诉模型“有什么证据、在哪里、为什么相关”，不是替代证据本身。

## 5. 客观结论

第 7 轮修改没有破坏七个 case。

它把 context engineering 从“尽量塞足信息”改成“让模型知道应该读什么、什么时候读”，更符合 feng 的文件化 self 和长任务设计。
